#!/usr/bin/python3

import os
import sys
import json
import errno
import optparse
import urllib.parse as up
import redis

#
# Command-line options
#

parser = optparse.OptionParser()
parser.add_option('--metadata', action="store", dest="metadata")
(options, args) = parser.parse_args()

#
# 1. Read metadata into object and parse out annotations path and genome
#

if not options.metadata:
  parser.error("Missing --metadata=<fn> parameter")
  sys.exit(errno.ENOENT)

with open(options.metadata, "r") as f:
  annotations_md = json.load(f)
  
try:
  annotation_id = annotations_md['id']
  annotation_created = annotations_md['created']
  annotation_description = annotations_md['description']
  annotation_version = annotations_md['version']
  annotation_assembly = annotations_md['assembly']
  annotations_uri = up.urlparse(annotations_md['uri'])
  annotations_path = annotations_uri.path
except KeyError as e:
  sys.stderr.write("Error: Could not retrieve keys from metadata [{}]\n".format(str(annotations_md)))
  sys.exit(errno.EINVAL)
except AttributeError as e:
  sys.stderr.write("Error: Could not retrieve URI from metadata [{}]\n".format(str(annotations_md)))
  sys.exit(errno.EINVAL)
except ValueError as e:
  sys.stderr.write("Error: Could not retrieve path from URI [{}]\n".format(str(annotations_uri)))
  sys.exit(errno.EINVAL)

#
# 2. Read annotations file line by line into Redis store
#

try:
  r = redis.StrictRedis(host='127.0.0.1', port=6379, db=0)
except NameError as e:
  sys.stderr.write('Error: Cannot import redis library\n')
  sys.exit(errno.EINVAL)
except ConnectionError as e:
  sys.stderr.write('Error: [{}] [{}]\n'.format(r, e))
  sys.exit(e.errno)

#
# Because annotations can share the same name across genomes, which
# would result in different coordinates, we create a separate autocomplete 
# set for each annotation upload
#
autocomplete_name = 'aid-{}'.format(annotation_id)

#
# We read prefixes and whole names into the per-genome annotation set.
# Additionally, we store the whole name as a per-genome object in the
# hashmap table.
#
with open(annotations_path, "r") as f:
  for line in f:
    e = line.rstrip().split('\t')
    
    #
    # We assume ID is in the fourth (name) column of a BED4+ file
    #
    try:
      annotation_chrom = e[0]
      annotation_start = int(e[1])
      annotation_stop = int(e[2])
      annotation_name = e[3]
      annotation_score = '.' if len(e) <= 4 else e[4]
      annotation_strand = '.' if len(e) <= 5 else e[5]
      annotation_thickStart = '.' if len(e) <= 6 else e[6]
      annotation_thickEnd = '.' if len(e) <= 7 else e[7]
      annotation_itemRgb = '.' if len(e) <= 8 else e[8]
      annotation_blockCount = '.' if len(e) <= 9 else e[9]
      annotation_blockSizes = '.' if len(e) <= 10 else e[10]
      annotation_blockStarts = '.' if len(e) <= 11 else e[11]
      annotation = {
        annotation_assembly: [{
          'description' : annotation_description,
          'version'     : annotation_version,
          'chrom'       : annotation_chrom,
          'start'       : annotation_start,
          'stop'        : annotation_stop,
          'name'        : annotation_name,
          'score'       : annotation_score,
          'strand'      : annotation_strand,
          'thickStart'  : annotation_thickStart,
          'thickEnd'    : annotation_thickEnd,
          'itemRgb'     : annotation_itemRgb,
          'blockCount'  : annotation_blockCount,
          'blockSizes'  : annotation_blockSizes,
          'blockStarts' : annotation_blockStarts
        }]
      }
    except IndexError as e:
      sys.stderr.write('Error: Malformed input; must be at least BED4 [{}]\n'.format(e))
      sys.exit(errno.EINVAL)
      
    #
    # We uppercase the name so that we can allow lowercase searches
    # The annotation record itself contains the "true" or unmodified name
    # so that queries can return that name for rendering the autocomplete
    # menu results
    #
    annotation_name = annotation_name.upper()

    #
    # Add prefixes
    #     
    for l in range(1, len(annotation_name)):
      prefix = annotation_name[0:l]
      try:
        r.zadd(autocomplete_name, { prefix: 0 } )
      except redis.exceptions.DataError as e:
        sys.stderr.write('Error: Set [autocomplete: {}] [{}]\n'.format(prefix, str(e)))
        sys.exit(errno.EINVAL)
    #
    # Add the name itself
    #
    r.zadd(autocomplete_name, { annotation_name: 0 })
    
    #
    # Add the % sentinel to denote the full annotation name
    #
    try:
      r.zadd(autocomplete_name, { annotation_name + '%': 0 })
    except redis.exceptions.DataError as e:
      sys.stderr.write('Error: Set [autocomplete: {}] [{}]\n'.format(annotation_name + '%', str(e)))
      sys.exit(errno.EINVAL)
    
    #
    # We need to add new entries with different version and description keys
    # Entries with the same version and description key are untouched
    #
    try:
      add_entry = True
      entries = r.hmget(annotation_name, annotation_assembly)
      if entries[0]:
        entries_array = json.loads(entries[0])
        for entry in entries_array:
          if entry['version'] == annotation_version and entry['description'] == annotation_description:
            add_entry = False
        if add_entry:
          entries_array.append(annotation[annotation_assembly][0])
      else:
        entries_array = annotation[annotation_assembly]
      serialized_annotation = { annotation_assembly : json.dumps(entries_array) }
      r.hmset(annotation_name, serialized_annotation)
    except redis.exceptions.DataError as e:
      sys.stderr.write('Error: Hash [hmset -> {}:{}] [{}]\n'.format(annotation_name, serialized_annotation, str(e)))
      sys.exit(errno.EINVAL)
      
  #
  # Add entries for the metadata record that was just added, using the uuid as the unique identifier
  #
  try:
    md_set_key = 'metadata'
    md_set_val = 'md-{}'.format(annotation_id)
    r.zadd(md_set_key, { md_set_val : 0 })
    serialized_metadata = { md_set_key : json.dumps(annotations_md) }
    r.hmset(md_set_val, serialized_metadata)
  except TypeError as e:
    sys.stderr.write('Error: TypeError\n')
    sys.stderr.write('Error: Hash [hmset -> {}:{}] [{}]\n'.format(md_set_val, serialized_metadata, str(e)))
    sys.exit(errno.EINVAL)
  except redis.exceptions.ResponseError as e:
    sys.stderr.write('Error: redis.exceptions.ResponseError\n')
    sys.stderr.write('Error: Set  [{}: {}] [{}]\n'.format(md_set_key, md_set_val, str(e)))
    sys.stderr.write('Error: Hash [hmset -> {}:{}] [{}]\n'.format(md_set_val, serialized_metadata, str(e)))
    sys.exit(errno.EINVAL)
  except redis.exceptions.DataError as e:
    sys.stderr.write('Error: redis.exceptions.DataError\n')
    sys.stderr.write('Error: Set  [{}: {}] [{}]\n'.format(md_set_key, md_set_val, str(e)))
    sys.stderr.write('Error: Hash [hmset -> {}:{}] [{}]\n'.format(md_set_val, serialized_metadata, str(e)))
    sys.exit(errno.EINVAL)

#
# 3. Delete annotations file, if successfully processed
#
try:
  os.remove(annotations_path)
except OSError as e:
  sys.exit(e.errno)
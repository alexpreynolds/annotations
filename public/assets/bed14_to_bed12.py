#!/usr/bin/env python

import sys

try:
    in_fn = sys.argv[1]
    out_fn = sys.argv[2]
except ValueError as err:
    sys.stderr.write("Error: missing parameters\n")

with open(in_fn, 'r') as ifh, open(out_fn, 'w') as ofh:
    for line in ifh:
        elems = line.rstrip().split('\t')
        items = []
        items.append(elems[0])
        items.append(elems[1])
        items.append(elems[2])
        items.append(elems[3])
        items.append(elems[4])
        items.append(elems[5])
        items.append(elems[10])
        items.append(elems[11])
        items.append('0')
        items.append(str(len(elems[12].split(',')) - 1))
        items.append(elems[13])
        items.append(elems[12])
        ofh.write('%s\n' % ('\t'.join(items)))
        
        

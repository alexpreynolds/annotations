var express = require('express');
var fileUpload = require('express-fileupload');
var router = express.Router({ strict: true });
var fs = require('fs');
var util = require('util');
var uuidv4 = require('uuid/v4');
var path = require('path');
var fileUrl = require('file-url');
var spawn = require('child_process').spawn;
var constants = require('../constants');
var redis = require('redis');
const {promisify} = require('util');

// default options
router.use(fileUpload({
  createParentPath: true,
  safeFileNames: true,
  preserveExtension: false,
  abortOnLimit: true,
  limits: { fileSize: constants.FILESIZE_LIMIT }
}));

// Redis setup
var redisClient = redis.createClient(6379, '127.0.0.1');
const delPromisified = promisify(redisClient.del).bind(redisClient);
const renamePromisified = promisify(redisClient.rename).bind(redisClient);
const zaddPromisified = promisify(redisClient.zadd).bind(redisClient);
const zrangePromisified = promisify(redisClient.zrange).bind(redisClient);
const zremPromisified = promisify(redisClient.zrem).bind(redisClient);
const hgetPromisified = promisify(redisClient.hget).bind(redisClient);

//
// CORS
//

let cors = require('cors');
let whitelist = ['http://epilogos.altius.org',
		 'http://epilogos.altius.org:3000',
		 'https://epilogos.altius.org',
		 'https://epilogos.altius.org:3000',
		 'http://' + constants.HOST,
		 'http://' + constants.HOST + ':3000',
		 'http://' + constants.HOST + ':8000',
		 'https://' + constants.HOST,
		 'https://' + constants.HOST + ':3000',
		 'https://' + constants.HOST + ':8000'];
//let whitelist = ['http://epilogos.altius.org', 'http://epilogos.altius.org:3000', 'http://' + constants.HOST, 'http://' + constants.HOST + ':3000', 'http://' + constants.HOST + ':8000'];
let corsOptions = {
  origin: function (origin, callback) {
    if (origin === undefined || whitelist.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error('Origin [' + origin + '] not allowed by CORS'))
      if (config.secure) {
      }
    }
  }
};

//
// DELETE example:
//
// $ curl -X "DELETE" http://localhost:8000/set?id=280dd7d0-2771-413a-9840-a16a25330072
//

router.delete('/', cors(corsOptions), function(req, res, next) {
  if (!req.query || !req.query.id) {
    return res.status(400).send('No parameters were specified.');
  }
    
  //
  // 1. Rename "aid-<ID>" annotation ID to a temporary name, using a prefix that other parts 
  //    of the application can use to limit set queries to valid annotation IDs, while the Redis 
  //    database takes care of deleting keys and values.
  //
  //    > RENAME aid-<ID> to-be-deleted-aid-<ID>
  //
  // 2. Remove all items in renamed "to-be-deleted-aid-<ID>" set.
  //
  //    > for <key> in ZRANGE to-be-deleted-aid-<ID> 0 -1: ZREM to-be-deleted-aid-<ID> <key>
  //
  // 3. Delete "to-be-deleted-aid-<ID>" key, itself.
  //
  //    > DEL to-be-deleted-aid-<ID>
  //
  
  let aidKey =  constants.REDIS_ANNOTATION_ID_PREFIX_KEY + req.query.id;
  let temporaryAidKey =  constants.REDIS_TBD_PREFIX_KEY + constants.REDIS_ANNOTATION_ID_PREFIX_KEY + req.query.id;
  
  let renameAidForDeletionPromise = renamePromisified(aidKey, temporaryAidKey)
    .then((renameRes) => {
      console.log("[" + req.query.id + "] annotation ID name renamed from [" + aidKey + "] to [" + temporaryAidKey + "] (" + renameRes + ")");
      return renameRes;
    })
    .catch((err) => {
      if (err) {
        console.log("[" + req.query.id + "] annotation ID name rename attempt from [" + aidKey + "] to [" + temporaryAidKey + "] failed (" + err + ")");
        return err;
      }
    });
  
  let zrangeAidForDeletionPromise = zrangePromisified(temporaryAidKey, 0, -1)
    .then((members) => {
      if (members.length == 0) {
        throw new Error("No zrange result found for specified temporary AID key", temporaryAidKey);
      }
      console.log("[" + req.query.id + "] annotation ID members from [" + temporaryAidKey + "] deleted");
      return members;
    })
    .catch((err) => {
      if (err) {
        console.log("[" + req.query.id + "] annotation ID member deletion attempt from [" + temporaryAidKey + "] failed (" + err + ")");
        return err;
      }
    });
    
  let zremAidItemPromise = (aidItem) => {
    return zremPromisified(temporaryAidKey, aidItem)
      .then((zremRes) => {
        return zremRes;
      })
      .catch((err) => {
        if (err) {
          return err;
        }
      });
    };
    
  let delAidForDeletionPromise = (temporaryAidKey) => {
    return delPromisified(temporaryAidKey)
      .then((delRes) => {
        return delRes;
      })
      .catch((err) => {
        if (err) {
          return err;
        }
      });
    };
  
  const zrangeAidForDeletionTasks = [renameAidForDeletionPromise, zrangeAidForDeletionPromise];
  return zrangeAidForDeletionTasks.reduce((promiseChain, currentTask) => {
    return promiseChain
      .then((chainResults) => currentTask.then(currentResult => [ ...chainResults, currentResult ]) )
  }, Promise.resolve([]))
    .then((values) => {
      if (values[0].code && values[0].code === "ERR") {
        throw new Error("No identifier found");
      }
      // values will be aid-<ID>'s items
      let zrangeAidItemPromises = String(values).split(',').map((aidItem) => {
        return zremAidItemPromise(aidItem);
      });
      Promise.all(zrangeAidItemPromises)
        .then((zrangeAidItemPromisesResults) => {
          // remove to-be-deleted-aid-<ID> once all items are deleted
          let delAidForDeletionPromiseInstance = delAidForDeletionPromise(temporaryAidKey);
          let delAidForDeletionPromises = [];
          delAidForDeletionPromises.push(delAidForDeletionPromiseInstance);
          Promise.all(delAidForDeletionPromises)
            .then((delAidForDeletionPromisesResults) => {
              console.log("[" + req.query.id + "] annotation key and prefix values removed");
              
              //
              // 1. Add new metadata ID key and remove old key
              //
              //    > ZADD <constants.REDIS_MD_KEY> to-be-deleted-md-<ID>
              //    > ZREM <constants.REDIS_MD_KEY> md-<ID>
              //
              // 2. Remove the metadata record for the specified (old) metadata key from hash
              //
              //    > DEL "to-be-deleted-md-<ID>"
              //
              
              let mdKey =  constants.REDIS_MD_ID_PREFIX_KEY + req.query.id;
              let temporaryMdKey =  constants.REDIS_TBD_PREFIX_KEY + constants.REDIS_MD_ID_PREFIX_KEY + req.query.id;
              
              let zaddTemporaryMdPromise = zaddPromisified(constants.REDIS_MD_KEY, temporaryMdKey)
                .then((zaddRes) => {
                  console.log("[" + req.query.id + "] metadata ID added [" + temporaryMdKey + "] (" + zaddRes + ")");
                  return zaddRes;
                })
                .catch((err) => {
                  if (err) {
                    console.log("[" + req.query.id + "] metadata ID zadd attempt to [" + temporaryMdKey + "] failed (" + err + ")");
                    return err;
                  }
                });
                
              Promise.resolve(zaddTemporaryMdPromise)
                .then((zaddTemporaryMdPromiseRes) => {
                  let zremMdPromise = zremPromisified(constants.REDIS_MD_KEY, mdKey)
                    .then((zremRes) => {
                      console.log("[" + req.query.id + "] metadata ID zrem'ed [" + mdKey + "] (" + zremRes + ")");
                      let renameMdForDeletionPromise = renamePromisified(mdKey, temporaryMdKey)
                        .then((renameRes) => {
                          console.log("[" + req.query.id + "] metadata ID renamed from [" + mdKey + "] to [" + temporaryMdKey + "] (" + renameRes + ")");
                          let delMdPromise = delPromisified(temporaryMdKey)
                            .then((delRes) => {
                              console.log("[" + req.query.id + "] metadata ID deleted [" + temporaryMdKey + "] (" + delRes + ")");
                              res.send(200);
                            })
                            .catch((err) => {
                              if (err) {
                                console.log("[" + req.query.id + "] metadata ID del attempt on [" + temporaryMdKey + "] failed (" + err + ")");
                                return res.status(500).send(err);
                              }
                            });
                        })
                        .catch((err) => {
                          if (err) {
                            console.log("[" + req.query.id + "] metadata ID rename attempt from [" + mdKey + "] to [" + temporaryMdKey + "] failed (" + err + ")");
                            return res.status(500).send(err);
                          }
                        });
                    })
                    .catch((err) => {
                      if (err) {
                        console.log("[" + req.query.id + "] metadata ID zrem attempt on [" + mdKey + "] failed (" + err + ")");
                        return res.status(500).send(err);
                      }
                    })
                })
                .catch((err) => {
                  if (err) {
                    console.log("[" + req.query.id + "] metadata ID zadd attempt on [" + temporaryMdKey + "] failed (" + err + ")");
                    return res.status(500).send(err);
                  }
                });
                
            })
            .catch((errs) => {
              console.log('del aid-<ID> errors:', errs);
              return res.status(500).send(errs);
            });
        })
        .catch((errs) => {
          console.log('zrem item errors:', errs);
          return res.status(500).send(errs);
        });
    })
    .catch((errs) => {
      //console.log('zrange errors:', errs);
      if (errs.message === "No identifier found") {
        return res.status(404).send(errs);
      }
      return res.status(500).send(errs);
    });
});

//
// GET example:
//
// $ curl http://localhost:8000/set?id=280dd7d0-2771-413a-9840-a16a25330072
//

router.get('/', cors(corsOptions), function(req, res, next) {
  if (req.query.id) {
    let hgetPromise = (mdKey) => {
      return hgetPromisified(mdKey, constants.REDIS_MD_KEY)
        .then((hgetRes) => {
          return hgetRes;
        })
        .catch((err) => {
          if (err) {
            return err;
          }
        });
      };
    
    let mdKey = constants.REDIS_MD_ID_PREFIX_KEY + req.query.id;
    let hgetPromiseInstance = hgetPromise(mdKey);
    let hgetPromises = [];
    hgetPromises.push(hgetPromiseInstance);
    
    // Resolve the promise to run HGET query on specified metadata ID
    Promise.all(hgetPromises)
      .then((hgetPromisesResults) => {
        // package per-key metadata
        let hgetResults = hgetPromisesResults.map((value) => {
          if (!value) {
            // return 404
            return res.status(404).send('No metadata available for specified identifier.');
          }
          return JSON.parse(value);
        });
        let packagedMd = { 'metadata' : hgetResults };
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify(packagedMd));
      })
      .catch((errs) => {
        console.log('hgets errors:', errs);
        return res.status(500).send(errs);
      });
  }
  else {
    return res.status(400).send('No valid GET query parameters were specified.');
  }
});

//
// POST example: 
//
// $ curl -F 'annotationFile=@/home/ubuntu/annotations-server/public/assets/refGene.hg38.c1t4u.bed' \
//        -F 'annotationDescription="refGene"' \
//        -F 'annotationVersion=1' \
//        -F 'annotationAssembly="hg38"' \
//        -F 'annotationType="bed12"' \
//        -F 'annotationTimestamp=1548189087529' http://localhost:8000/set
//

router.post('/', cors(corsOptions), function(req, res) {  
  
  req.connection.setTimeout(100000);
  
  if (!req.files) {
    return res.status(400).send('No files were uploaded.');
  }
    
  let annotationFile = req.files.annotationFile;  
  if (!annotationFile) {
    annotationFile = req.files.file;
  }

  // Set up destination filename and folder, if necessary
  let id = uuidv4();
  let destDir = path.join(constants.ASSETS, id);
  if (!fs.existsSync(constants.ASSETS)) {
    fs.mkdirSync(constants.ASSETS);
    fs.chmodSync(constants.ASSETS, 0777);
  }
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
    fs.chmodSync(destDir, 0777);
  }
  
  // Use the mv() method to place the file on the server
  let destAnnotationFile = path.join(destDir, 'coordinates.bed');
  let writeAnnotationFilePromise = annotationFile.mv(destAnnotationFile)
    .then(() => {
      return "[" + id + "] wrote BED coordinates";
    })
    .catch((err) => {
      if (err) {
        return err;
      }
    });
    
  // Write JSON metadata object to file (description, genome, and fully-qualified path to BED file)
  let metadata = {
    "id" :          id,
    "description" : req.body.annotationDescription,
    "version" :     req.body.annotationVersion,
    "assembly" :    req.body.annotationAssembly,
    "type" :        req.body.annotationType,
    "uri" :         fileUrl(destAnnotationFile), 
    "created" :     req.body.annotationTimestamp,
  };
  let destMetadataFile = path.join(destDir, 'metadata.json');
  let fsWriteFilePromisified = util.promisify(fs.writeFile);
  let writeMetadataFilePromise = fsWriteFilePromisified(destMetadataFile, JSON.stringify(metadata, null, 2))
    .then(() => {
      return "[" + id + "] wrote metadata";
    })
    .catch((err) => {
      if (err) {
        return err;
      }
    });
    
  // Start processing BED file into Redis store, using metadata payload
  let processAnnotationsPromise = () => {
    return new Promise((resolve, reject) => {
      let processAnnotationsScript = path.join(__dirname, '..', 'bin', 'uploadAnnotations.py');
      if (!fs.existsSync(processAnnotationsScript)) {
        reject(Error('Annotations processing script could not be found [' + processAnnotationsScript + ']'));
      }
      if (!fs.existsSync(destMetadataFile)) {
        reject(Error('Specified metadata could not be found [' + destMetadataFile + ']'));
      }
      let annotationScriptSpawnList = [processAnnotationsScript, '--metadata=\"' + destMetadataFile + '\"'];
      var processAnnotationsSpawn = spawn('python3', 
        annotationScriptSpawnList,
  			{
  			    stdio : 'ignore',
  			    detached : true,
  			    shell : true,
  			    env : process.env
  			}
      );
      // Report useful job state data
      processAnnotationsSpawn.on('exit', function (code, signal) {
        console.log("[" + id + "] annotations processing script exited with " + `code ${code} and signal ${signal}`);
      });
      // Ensure that the spawned script is detached
    	// cf. https://stackoverflow.com/questions/12871740/how-to-detach-a-spawned-child-process-in-a-node-js-script
      processAnnotationsSpawn.unref();
      resolve("[" + id + "] spawned annotations processing job");
    })
  }

  // Resolve all upload promises in serial order, then upon success, resolve the annotation process job spawn
  const tasks = [writeAnnotationFilePromise, writeMetadataFilePromise];
  return tasks.reduce((promiseChain, currentTask) => {
    return promiseChain.then((chainResults) => currentTask.then(currentResult => [ ...chainResults, currentResult ]))
  }, Promise.resolve([]))
    .then((values) => {
      console.log(values.join('\n'));
      if (!fs.existsSync(destMetadataFile)) {
        return res.status(404).send('Specified metadata could not be found [' + destMetadataFile + ']');
      }
      else {
        processAnnotationsPromise()
          .then((result) => {
            console.log(result);
            res.json(metadata);
          })
          .catch((err) => {
            if (err) {
              console.log('process error:', err);
              return res.status(500).send(err);
            }
          })
      }
    })
    .catch((errs) => {
      console.log('upload errors:', errs);
      return res.status(500).send(errs);
    });

});

module.exports = router;

var express = require('express');
var router = express.Router({ strict: true });
var redis = require('redis');
var util = require('util');
const {promisify} = require('util');
var constants = require('../constants');

// Redis setup
var redisClient = redis.createClient(6379, '127.0.0.1');
const zrankPromisified = promisify(redisClient.zrank).bind(redisClient);
const zrangePromisified = promisify(redisClient.zrange).bind(redisClient);
const hgetPromisified = promisify(redisClient.hget).bind(redisClient);
const hmgetPromisified = promisify(redisClient.hmget).bind(redisClient);

//
// CORS
//

let cors = require('cors');
let whitelist = ['http://epilogos.altius.org', 'http://epilogos.altius.org:3000', 'http://' + constants.HOST, 'http://' + constants.HOST + ':3000', 'http://' + constants.HOST + ':8000'];
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
// GET request returns all records for all metadata entries 
//

router.get('/', cors(corsOptions), function(req, res, next) {
  //
  // get list of metadata keys
  //
  // $ redis-cli
  // 127.0.0.1:6379> ZRANGE metadata 0 -1
  // 1) "md-607a7c89-f7c3-4628-89b8-d013ea98eea4"
  // 2) "md-fa4f225c-69ea-423f-8129-9364df20b306"
  //
  // get metadata for each key
  //
  // > HGET md-fa4f225c-69ea-423f-8129-9364df20b306 metadata
  // "{
  //   \"id\": \"fa4f225c-69ea-423f-8129-9364df20b306\", 
  //   \"description\": \"test2\", 
  //   \"version\": \"1\", 
  //   \"assembly\": \"hg38\", 
  //   \"uri\": \"file:///home/ubuntu/epilogos/epilogos-annotations/assets/fa4f225c-69ea-423f-8129-9364df20b306/coordinates.bed\", 
  //   \"created\": \"1544654122629\"
  // }"
  //
  // curl "http://localhost:8000/sets?q=HOXA&assembly=hg38&..."

  // the zrangeMdPromise returns a list of all metadata keys  
  let zrangeMdPromise = zrangePromisified(constants.REDIS_MD_KEY, 0, -1)
    .then((members) => {
      return members;
    })
    .catch((err) => {
      if (err) {
        return err;
      }
    });
  
  // a query for a per-key metadata object returns a Promise for later resolution
  let hgetPromise = (mdKey) => {
    return hgetPromisified(mdKey, constants.REDIS_MD_KEY)
      .then((hgetRes) => {
        return hgetRes;
      })
      .catch((err) => {
        if (err) {
          console.log("[" + req.query.id + "] hget on metadata ID attempt from [" + mdKey + "] failed (" + err + ")");
          return err;
        }
      });
    };
    
  let hmgetAnnotationNamePromise = (annotationName, assembly) => {
    return hmgetPromisified(annotationName, assembly)
      .then((hmgetRes) => {
        //console.log("annotationName", annotationName);
        //console.log("assembly", assembly);
        //console.log("hmgetRes", hmgetRes);
        return [annotationName, hmgetRes];
      })
      .catch((err) => {
        if (err) {
          console.log("[" + req.query.id + "] hmget on annotation name [" + annotationName + "] and assembly [" + assembly + "] failed (" + err + ")");
          return err;
        }
      });
    };
    
  // find index or rank of match of query prefix in aid-<ID> set
  let zrankAidPromise = (aidKey, queryPrefix) => {
    return zrankPromisified(aidKey, queryPrefix)
      .then((zrankRes) => {
        return { 'start': zrankRes, 'aidKey': aidKey, 'queryPrefix': queryPrefix, 'matches': [] };
      })
      .catch((err) => {
        if (err) {
          console.log("[" + req.query.id + "] annotation ID rank attempt from [" + aidKey + "] failed (" + err + ")");
          return err;
        }
      });
    };
    
  // the zrangeAidPromise returns a list of all prefixes from the specified indices  
  let zrangeAidPromise = (aidKey, start, end) => {
    return zrangePromisified(aidKey, start, end)
    .then((members) => {
      return members;
    })
    .catch((err) => {
      if (err) {
        console.log("[" + req.query.id + "] annotation ID range query on [" + aidKey + "] failed (" + err + ")");
        return err;
      }
    });
  };
  
  // process the key listing, map resulting keys to Promises, and return a packaged list of metadata objects
  const tasks = [zrangeMdPromise];
  return tasks.reduce((promiseChain, currentTask) => {
    return promiseChain.then((chainResults) => currentTask.then(currentResult => [ ...chainResults, currentResult ]))
  }, Promise.resolve([]))
    .then((values) => {
      // values will be metadata keys
      let hgetPromises = String(values).split(',').map((mdKey) => {
        // filter out any metadata keys that are in the process of being deleted ("TBD")
        if (!mdKey.startsWith(constants.REDIS_TBD_PREFIX_KEY))
          return hgetPromise(mdKey);
      });
      Promise.all(hgetPromises)
        .then((hgetPromisesResults) => {
          // repackage per-key metadata
          let hgetResults = hgetPromisesResults.map((value) => {
            let obj = JSON.parse(value);
            let objRepackaged = {
              'id': obj.id,
              'description': obj.description,
              'version': obj.version,
              'assembly': obj.assembly,
              'created': obj.created
            };
            return objRepackaged;
          });
          let packagedResponse = { 'metadata' : hgetResults };          
          if (Object.keys(req.query).length !== 0) {
            // filter hgetResults
            let filteredHgetResults = hgetResults;
            
            // filter by assembly
            if (req.query.assembly) {
              //console.log("filtering by assembly...");
              filteredHgetResults = filteredHgetResults.filter((value) => {
                return value.assembly === req.query.assembly;
              });
            }
            
            // filter by version
            if (req.query.version) {
              //console.log("filtering by version...");
              filteredHgetResults = filteredHgetResults.filter((value) => {
                return value.version === req.query.version;
              });
            }
            
            // filter by most recent timestamp
            if (req.query.mostRecent && (req.query.mostRecent === "t")) {
              //console.log("filtering by timestamp...");
              let fhrMdCopy = filteredHgetResults.slice(0);
              let dgPairs = {};
              fhrMdCopy.forEach((value) => {
                let dgKey = value.description + "__" + value.version + "__" + value.assembly;
                if (!dgPairs.hasOwnProperty(dgKey)) {
                  dgPairs[dgKey] = [];
                }
                dgPairs[dgKey].push(value.created);
              });
              dgPairMostRecent = {};
              // get first timestamp
              Object.keys(dgPairs).forEach((key) => {
                // sort kv pair of created/timestamps in descending order, so that the newest timestamp is first
                dgPairs[key].sort((a, b) => b - a);
                dgPairMostRecent[key] = dgPairs[key][0];
              });
              // put qualifying pair into filtered results
              let refilteredHgetResults = [];
              Object.keys(dgPairMostRecent).forEach((key) => {
                let keyPair = key.split(/__/);
                let description = keyPair[0];
                let version = keyPair[1];
                let assembly = keyPair[2];
                let created = dgPairMostRecent[key];
                fhrMdCopy.forEach((value) => {
                  if ((value.description === description) && (value.version === version) && (value.assembly === assembly) && (value.created === created)) {
                    refilteredHgetResults.push(value);
                  }
                });
              });
              filteredHgetResults = refilteredHgetResults;
              if (!req.query.q && (filteredHgetResults.length > 0)) {
                packagedResponse = { 'metadata' : filteredHgetResults };
                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify(packagedResponse));
              }
            }
            
            if (filteredHgetResults.length === 0) {
              packagedResponse = { 'metadata' : filteredHgetResults };
              res.setHeader('Content-Type', 'application/json');
              res.send(JSON.stringify(packagedResponse));
            }
            
            // if there is a query for a prefix, set up promises
            if (req.query.q && (req.query.q.length >= constants.MIN_QUERY_PREFIX_LENGTH)) {
              //console.log("filtering by prefix...");
              
              // we uppercase the query parameter so that we can deal with
              // mouse and other annotation names that are mixed-case              
              req.query.q = req.query.q.toUpperCase();
              
              let zrankAidPromises = [];
              
              filteredHgetResults.forEach((value) => {
                let aidKey = constants.REDIS_ANNOTATION_ID_PREFIX_KEY + value.id; 
                zrankAidPromises.push(zrankAidPromise(aidKey, req.query.q))
              });
              
              Promise.all(zrankAidPromises)
                .then((zrankAidPromisesResults) => {

                  packagedSearch = [];
                  packagedHits = [];
                  
                  zrankAidPromisesResults.forEach((zrankAidPromisesResult, idx, arr) => {
                    
                    let aidKey = zrankAidPromisesResult.aidKey;
                    let start = zrankAidPromisesResult.start;
                    let count = constants.MAX_QUERY_RESULT_COUNT;
                    let end = start + constants.MAX_QUERY_STEP_COUNT - 1;
                    let pastRange = false;
                    let results = [];

                    function next(aidKey, start, end, pastRange) {
                      return zrangeAidPromise(aidKey, start, end)
                        .then((zrangeResults) => {
                          zrangeResults.forEach((zrangeRes) => {
                            if (!pastRange) {
                              let minlen = Math.min(zrangeRes.length, req.query.q.length);
                              if (zrangeRes.substring(0, minlen) != req.query.q.substring(0, minlen)) {
                                count = results.length;
                                pastRange = true;
                              }
                              else if ((zrangeRes.substr(-1) === "%") && (results.length != count)) {
                                let annotationName = zrangeRes.substr(0, zrangeRes.length-1);
                                results.push(annotationName);
                              }
                            }                      
                          });
                          if (!pastRange && (results.length < (count - 1))) {
                            // adjust bounds and make another next() call...
                            start += constants.MAX_QUERY_STEP_COUNT;
                            end = start + constants.MAX_QUERY_STEP_COUNT - 1;
                            return next(aidKey, start, end, pastRange);
                          }
                        })
                        .catch((err) => {
                          console.log('zrank aid-<ID> + query prefix error:', err);
                        });
                    }
                    
                    function packageMatchDetails(matches, assembly, package) {
                      let hmgetAnnotationNamePromises = [];
                      let results = [];
                      matches.forEach((match) => {
                        let p = hmgetAnnotationNamePromise(match, assembly)
                          .then((hmgetResults) => {
                            let name = hmgetResults[0];
                            let hits = JSON.parse(hmgetResults[1]);
                            let result = {};
                            result[name] = hits;
                            return result;
                          })
                          .catch((err) => {
                            console.log('hmget annotationName + assembly query error:', err);
                            return res.status(500).send(err);
                          });
                        hmgetAnnotationNamePromises.push(p);
                      })
                      Promise.all(hmgetAnnotationNamePromises)
                        .then((hmgetPromisesResults) => {
                          let flattenedResults = Object.assign(...hmgetPromisesResults);
                          package['hits'] = flattenedResults;
                          res.setHeader('Content-Type', 'application/json');
                          res.send(JSON.stringify(package));
                        })
                        .catch((err) => {
                          console.log('hmget all query error:', err);
                          return res.status(500).send(err);
                        })
                    }
                    
                    if (start) {
                      next(aidKey, start, end, pastRange)
                        .then((result) => {
                          //console.log('next result is past range:', pastRange, results, zrankAidPromisesResult);
                          let matches = results.slice(0);
                          let assembly = req.query.assembly || constants.DEFAULT_ASSEMBLY;
                          zrankAidPromisesResult["matches"] = matches;
                          packagedSearch.push(zrankAidPromisesResult);
                          //console.log("packagedSearch", packagedSearch);
                          if (idx == arr.length - 1) {
                            let package = { 'metadata' : filteredHgetResults, 'search' : packagedSearch, 'hits' : packagedHits };
                            packageMatchDetails(matches, assembly, package);
                          }
                        })
                        .catch((err) => {
                          console.log('next final error:', err);
                          return res.status(500).send(err);
                        });
                    }
                    else {
                      packagedResponse = { 'metadata' : filteredHgetResults, 'search' : packagedSearch, 'hits' : packagedHits };
                      res.setHeader('Content-Type', 'application/json');
                      res.send(JSON.stringify(packagedResponse));
                    }
                  });
                })
                .catch((errs) => {
                  console.log('zrank aid-<ID> + query prefix errors:', errs);
                  results.push(errs);
                });
            }
            else {
              res.status(204).send();
            }
          }
          else {
            res.status(204).send();
          }
        })
        .catch((errs) => {
          console.log('hgets errors:', errs);
          return res.status(500).send(errs);
        });
    })
    .catch((errs) => {
      console.log('zranges errors:', errs);
      return res.status(500).send(errs);
    });
});

module.exports = router;
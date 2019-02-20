var path = require('path');

var assetsDir = path.join(__dirname, '../annotations-server-assets');

module.exports = Object.freeze({
    HOST:                           'ec2-52-15-159-92.us-east-2.compute.amazonaws.com',
    ASSETS:                         assetsDir,
    REDIS_MD_KEY:                   'metadata',
    REDIS_MD_ID_PREFIX_KEY:         'md-',
    REDIS_ANNOTATION_ID_PREFIX_KEY: 'aid-',
    REDIS_TBD_PREFIX_KEY:           'to-be-deleted-',
    FILESIZE_LIMIT:                 128 * 1024 * 1024,
    MIN_QUERY_PREFIX_LENGTH:        2,
    MAX_QUERY_RESULT_COUNT:         100,
    MAX_QUERY_STEP_COUNT:           50,
    DEFAULT_ASSEMBLY:               'hg19',
});
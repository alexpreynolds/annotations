var express = require('express');
var router = express.Router({ strict: true });
var redis = require('redis');
var util = require('util');
var constants = require('../constants');

// CORS
let cors = require('cors')
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

router.get('/', cors(corsOptions), function(req, res, next) {
    res.status(301).redirect('http://' + constants.HOST);
});

module.exports = router;

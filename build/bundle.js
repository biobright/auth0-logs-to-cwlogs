module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/build/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	var _logTypes;

	function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

	var async = __webpack_require__(1);
	var moment = __webpack_require__(2);
	var useragent = __webpack_require__(3);
	var express = __webpack_require__(4);
	var Webtask = __webpack_require__(5);
	var app = express();
	var CWLogsWritable = __webpack_require__(16);
	var uuid = __webpack_require__(22);
	var Request = __webpack_require__(15);
	var memoizer = __webpack_require__(23);

	function onError(err, logEvents, next) {
	  // Copied verbatim from `cwlogs-writable` documentation.
	  // Use built-in behavior if the error is not
	  // from a PutLogEvents action (logEvents will be null).
	  if (!logEvents) {
	    next(err);
	    return;
	  }
	  // Requeue the log events after a delay,
	  // if the queue is small enough.
	  if (this.getQueueSize() < 100) {
	    setTimeout(function () {
	      // Pass the logEvents to the "next" callback
	      // so they are added back to the head of the queue.
	      next(logEvents);
	    }, 2000);
	  }
	  // Otherwise, log the events to the console
	  // and resume streaming.
	  else {
	      console.error('Failed to send logEvents: ' + JSON.stringify(logEvents));
	      next();
	    }
	}

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AWS_LOG_GROUP', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.storage.get(function (err, data) {
	    var startCheckpointId = typeof data === 'undefined' ? null : data.checkpointId;

	    if (err) {
	      console.log('storage.get', err);
	    }

	    // Create a new event logger
	    var Logger = new CWLogsWritable({
	      logGroupName: ctx.data.AWS_LOG_GROUP,
	      logStreamName: uuid.v4(),
	      // Options passed to the AWS.CloudWatchLogs service.
	      cloudWatchLogsOptions: {
	        // Change the AWS region as needed.
	        region: ctx.data.AWS_REGION,
	        accessKeyId: ctx.data.AWS_ACCESS_KEY_ID,
	        secretAccessKey: ctx.data.AWS_SECRET_ACCESS_KEY
	      }
	    });

	    // Start the process.
	    async.waterfall([function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log('Logs from: ' + (context.checkpointId || 'Start') + '.');

	        var take = Number.parseInt(ctx.data.BATCH_SIZE);

	        take = take > 100 ? 100 : take;

	        context.logs = context.logs || [];

	        getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, function (logs, err) {
	          if (err) {
	            console.log('Error getting logs from Auth0', err);
	            return callback(err);
	          }

	          if (logs && logs.length) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	            // return setImmediate(() => getLogs(context));
	          }

	          console.log('Total logs: ' + context.logs.length + '.');
	          return callback(null, context);
	        });
	      };

	      getLogs({ checkpointId: startCheckpointId });
	    }, function (context, callback) {
	      var min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
	      var log_matches_level = function log_matches_level(log) {
	        if (logTypes[log.type]) {
	          return logTypes[log.type].level >= min_log_level;
	        }
	        return true;
	      };

	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Sending ' + context.logs.length);
	      if (context.logs.length > 0) {
	        context.logs.map(function (logEntry) {
	          Logger.write(logEntry);
	        });
	        return callback(null, context);
	      } else {
	        // no logs, just callback
	        console.log('No logs to upload - completed.');
	        return callback(null, context);
	      }
	    }], function (err, context) {
	      if (err) {
	        console.log('Job failed.', err);

	        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, function (error) {
	          if (error) {
	            console.log('Error storing startCheckpoint', error);
	            return res.status(500).send({ error: error });
	          }

	          res.status(500).send({
	            error: err
	          });
	        });
	      }

	      console.log('Job complete.');

	      return req.webtaskContext.storage.set({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }, { force: 1 }, function (error) {
	        if (error) {
	          console.log('Error storing checkpoint', error);
	          return res.status(500).send({ error: error });
	        }

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = (_logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'seccft': {
	    event: 'Success Exchange (Client Credentials)',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
	    level: 3 // Error
	  },
	  'feccft': {
	    event: 'Failed Exchange (Client Credentials)',
	    level: 3 // Error
	  },
	  'f': {
	    event: 'Failed Login',
	    level: 3 // Error
	  },
	  'w': {
	    event: 'Warnings During Login',
	    level: 2 // Warning
	  },
	  'du': {
	    event: 'Deleted User',
	    level: 1 // Info
	  },
	  'fu': {
	    event: 'Failed Login (invalid email/username)',
	    level: 3 // Error
	  },
	  'fp': {
	    event: 'Failed Login (wrong password)',
	    level: 3 // Error
	  },
	  'fc': {
	    event: 'Failed by Connector',
	    level: 3 // Error
	  },
	  'fco': {
	    event: 'Failed by CORS',
	    level: 3 // Error
	  },
	  'con': {
	    event: 'Connector Online',
	    level: 1 // Info
	  },
	  'coff': {
	    event: 'Connector Offline',
	    level: 3 // Error
	  },
	  'fcpro': {
	    event: 'Failed Connector Provisioning',
	    level: 4 // Critical
	  },
	  'ss': {
	    event: 'Success Signup',
	    level: 1 // Info
	  },
	  'fs': {
	    event: 'Failed Signup',
	    level: 3 // Error
	  },
	  'cs': {
	    event: 'Code Sent',
	    level: 0 // Debug
	  },
	  'cls': {
	    event: 'Code/Link Sent',
	    level: 0 // Debug
	  },
	  'sv': {
	    event: 'Success Verification Email',
	    level: 0 // Debug
	  },
	  'fv': {
	    event: 'Failed Verification Email',
	    level: 0 // Debug
	  },
	  'scp': {
	    event: 'Success Change Password',
	    level: 1 // Info
	  },
	  'fcp': {
	    event: 'Failed Change Password',
	    level: 3 // Error
	  },
	  'sce': {
	    event: 'Success Change Email',
	    level: 1 // Info
	  },
	  'fce': {
	    event: 'Failed Change Email',
	    level: 3 // Error
	  },
	  'scu': {
	    event: 'Success Change Username',
	    level: 1 // Info
	  },
	  'fcu': {
	    event: 'Failed Change Username',
	    level: 3 // Error
	  },
	  'scpn': {
	    event: 'Success Change Phone Number',
	    level: 1 // Info
	  },
	  'fcpn': {
	    event: 'Failed Change Phone Number',
	    level: 3 // Error
	  },
	  'svr': {
	    event: 'Success Verification Email Request',
	    level: 0 // Debug
	  },
	  'fvr': {
	    event: 'Failed Verification Email Request',
	    level: 3 // Error
	  },
	  'scpr': {
	    event: 'Success Change Password Request',
	    level: 0 // Debug
	  },
	  'fcpr': {
	    event: 'Failed Change Password Request',
	    level: 3 // Error
	  },
	  'fn': {
	    event: 'Failed Sending Notification',
	    level: 3 // Error
	  },
	  'sapi': {
	    event: 'API Operation'
	  },
	  'fapi': {
	    event: 'Failed API Operation'
	  },
	  'limit_wc': {
	    event: 'Blocked Account',
	    level: 4 // Critical
	  },
	  'limit_ui': {
	    event: 'Too Many Calls to /userinfo',
	    level: 4 // Critical
	  },
	  'api_limit': {
	    event: 'Rate Limit On API',
	    level: 4 // Critical
	  },
	  'sdu': {
	    event: 'Successful User Deletion',
	    level: 1 // Info
	  },
	  'fdu': {
	    event: 'Failed User Deletion',
	    level: 3 // Error
	  }
	}, _defineProperty(_logTypes, 'fapi', {
	  event: 'Failed API Operation',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_wc', {
	  event: 'Blocked Account',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_mu', {
	  event: 'Blocked IP Address',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'slo', {
	  event: 'Success Logout',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'flo', {
	  event: ' Failed Logout',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'sd', {
	  event: 'Success Delegation',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'fd', {
	  event: 'Failed Delegation',
	  level: 3 // Error
	}), _logTypes);

	function getLogsFromAuth0(domain, token, take, from, cb) {
	  var url = 'https://' + domain + '/api/v2/logs';

	  Request({
	    method: 'GET',
	    url: url,
	    json: true,
	    qs: {
	      take: take,
	      from: from,
	      sort: 'date:1',
	      per_page: take
	    },
	    headers: {
	      Authorization: 'Bearer ' + token,
	      Accept: 'application/json'
	    }
	  }, function (err, res, body) {
	    if (err || res.statusCode !== 200) {
	      console.log('Error getting logs', err);
	      cb(null, err || body);
	    } else {
	      cb(body);
	    }
	  });
	}

	var getTokenCached = memoizer({
	  load: function load(apiUrl, audience, clientId, clientSecret, cb) {
	    Request({
	      method: 'POST',
	      url: apiUrl,
	      json: true,
	      body: {
	        audience: audience,
	        grant_type: 'client_credentials',
	        client_id: clientId,
	        client_secret: clientSecret
	      }
	    }, function (err, res, body) {
	      if (err) {
	        cb(null, err);
	      } else {
	        cb(body.access_token);
	      }
	    });
	  },
	  hash: function hash(apiUrl) {
	    return apiUrl;
	  },
	  max: 100,
	  maxAge: 1000 * 60 * 60
	});

	app.use(function (req, res, next) {
	  var apiUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
	  var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
	  var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
	  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

	  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
	    if (err) {
	      console.log('Error getting access_token', err);
	      return next(err);
	    }

	    req.access_token = access_token;
	    next();
	  });
	});

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	module.exports = Webtask.fromExpress(app);

/***/ }),
/* 1 */
/***/ (function(module, exports) {

	module.exports = require("async");

/***/ }),
/* 2 */
/***/ (function(module, exports) {

	module.exports = require("moment");

/***/ }),
/* 3 */
/***/ (function(module, exports) {

	module.exports = require("useragent");

/***/ }),
/* 4 */
/***/ (function(module, exports) {

	module.exports = require("express");

/***/ }),
/* 5 */
/***/ (function(module, exports, __webpack_require__) {

	exports.auth0 = __webpack_require__(6);
	exports.fromConnect = exports.fromExpress = fromConnect;
	exports.fromHapi = fromHapi;
	exports.fromServer = exports.fromRestify = fromServer;

	// API functions

	function addAuth0(func) {
	    func.auth0 = function (options) {
	        return exports.auth0(func, options);
	    }

	    return func;
	}

	function fromConnect (connectFn) {
	    return addAuth0(function (context, req, res) {
	        var normalizeRouteRx = createRouteNormalizationRx(req.x_wt.jtn);

	        req.originalUrl = req.url;
	        req.url = req.url.replace(normalizeRouteRx, '/');
	        req.webtaskContext = attachStorageHelpers(context);

	        return connectFn(req, res);
	    });
	}

	function fromHapi(server) {
	    var webtaskContext;

	    server.ext('onRequest', function (request, response) {
	        var normalizeRouteRx = createRouteNormalizationRx(request.x_wt.jtn);

	        request.setUrl(request.url.replace(normalizeRouteRx, '/'));
	        request.webtaskContext = webtaskContext;
	    });

	    return addAuth0(function (context, req, res) {
	        var dispatchFn = server._dispatch();

	        webtaskContext = attachStorageHelpers(context);

	        dispatchFn(req, res);
	    });
	}

	function fromServer(httpServer) {
	    return addAuth0(function (context, req, res) {
	        var normalizeRouteRx = createRouteNormalizationRx(req.x_wt.jtn);

	        req.originalUrl = req.url;
	        req.url = req.url.replace(normalizeRouteRx, '/');
	        req.webtaskContext = attachStorageHelpers(context);

	        return httpServer.emit('request', req, res);
	    });
	}


	// Helper functions

	function createRouteNormalizationRx(jtn) {
	    var normalizeRouteBase = '^\/api\/run\/[^\/]+\/';
	    var normalizeNamedRoute = '(?:[^\/\?#]*\/?)?';

	    return new RegExp(
	        normalizeRouteBase + (
	        jtn
	            ?   normalizeNamedRoute
	            :   ''
	    ));
	}

	function attachStorageHelpers(context) {
	    context.read = context.secrets.EXT_STORAGE_URL
	        ?   readFromPath
	        :   readNotAvailable;
	    context.write = context.secrets.EXT_STORAGE_URL
	        ?   writeToPath
	        :   writeNotAvailable;

	    return context;


	    function readNotAvailable(path, options, cb) {
	        var Boom = __webpack_require__(14);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function readFromPath(path, options, cb) {
	        var Boom = __webpack_require__(14);
	        var Request = __webpack_require__(15);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        Request({
	            uri: context.secrets.EXT_STORAGE_URL,
	            method: 'GET',
	            headers: options.headers || {},
	            qs: { path: path },
	            json: true,
	        }, function (err, res, body) {
	            if (err) return cb(Boom.wrap(err, 502));
	            if (res.statusCode === 404 && Object.hasOwnProperty.call(options, 'defaultValue')) return cb(null, options.defaultValue);
	            if (res.statusCode >= 400) return cb(Boom.create(res.statusCode, body && body.message));

	            cb(null, body);
	        });
	    }

	    function writeNotAvailable(path, data, options, cb) {
	        var Boom = __webpack_require__(14);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function writeToPath(path, data, options, cb) {
	        var Boom = __webpack_require__(14);
	        var Request = __webpack_require__(15);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        Request({
	            uri: context.secrets.EXT_STORAGE_URL,
	            method: 'PUT',
	            headers: options.headers || {},
	            qs: { path: path },
	            body: data,
	        }, function (err, res, body) {
	            if (err) return cb(Boom.wrap(err, 502));
	            if (res.statusCode >= 400) return cb(Boom.create(res.statusCode, body && body.message));

	            cb(null);
	        });
	    }
	}


/***/ }),
/* 6 */
/***/ (function(module, exports, __webpack_require__) {

	var url = __webpack_require__(7);
	var error = __webpack_require__(8);
	var handleAppEndpoint = __webpack_require__(9);
	var handleLogin = __webpack_require__(11);
	var handleCallback = __webpack_require__(12);

	module.exports = function (webtask, options) {
	    if (typeof webtask !== 'function' || webtask.length !== 3) {
	        throw new Error('The auth0() function can only be called on webtask functions with the (ctx, req, res) signature.');
	    }
	    if (!options) {
	        options = {};
	    }
	    if (typeof options !== 'object') {
	        throw new Error('The options parameter must be an object.');
	    }
	    if (options.scope && typeof options.scope !== 'string') {
	        throw new Error('The scope option, if specified, must be a string.');
	    }
	    if (options.authorized && ['string','function'].indexOf(typeof options.authorized) < 0 && !Array.isArray(options.authorized)) {
	        throw new Error('The authorized option, if specified, must be a string or array of strings with e-mail or domain names, or a function that accepts (ctx, req) and returns boolean.');
	    }
	    if (options.exclude && ['string','function'].indexOf(typeof options.exclude) < 0 && !Array.isArray(options.exclude)) {
	        throw new Error('The exclude option, if specified, must be a string or array of strings with URL paths that do not require authentication, or a function that accepts (ctx, req, appPath) and returns boolean.');
	    }
	    if (options.clientId && typeof options.clientId !== 'function') {
	        throw new Error('The clientId option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Client ID.');
	    }
	    if (options.clientSecret && typeof options.clientSecret !== 'function') {
	        throw new Error('The clientSecret option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Client Secret.');
	    }
	    if (options.domain && typeof options.domain !== 'function') {
	        throw new Error('The domain option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Domain.');
	    }
	    if (options.webtaskSecret && typeof options.webtaskSecret !== 'function') {
	        throw new Error('The webtaskSecret option, if specified, must be a function that accepts (ctx, req) and returns a key to be used to sign issued JWT tokens.');
	    }
	    if (options.getApiKey && typeof options.getApiKey !== 'function') {
	        throw new Error('The getApiKey option, if specified, must be a function that accepts (ctx, req) and returns an apiKey associated with the request.');
	    }
	    if (options.loginSuccess && typeof options.loginSuccess !== 'function') {
	        throw new Error('The loginSuccess option, if specified, must be a function that accepts (ctx, req, res, baseUrl) and generates a response.');
	    }
	    if (options.loginError && typeof options.loginError !== 'function') {
	        throw new Error('The loginError option, if specified, must be a function that accepts (error, ctx, req, res, baseUrl) and generates a response.');
	    }

	    options.clientId = options.clientId || function (ctx, req) {
	        return ctx.secrets.AUTH0_CLIENT_ID;
	    };
	    options.clientSecret = options.clientSecret || function (ctx, req) {
	        return ctx.secrets.AUTH0_CLIENT_SECRET;
	    };
	    options.domain = options.domain || function (ctx, req) {
	        return ctx.secrets.AUTH0_DOMAIN;
	    };
	    options.webtaskSecret = options.webtaskSecret || function (ctx, req) {
	        // By default we don't expect developers to specify WEBTASK_SECRET when
	        // creating authenticated webtasks. In this case we will use webtask token
	        // itself as a JWT signing key. The webtask token of a named webtask is secret
	        // and it contains enough entropy (jti, iat, ca) to pass
	        // for a symmetric key. Using webtask token ensures that the JWT signing secret 
	        // remains constant for the lifetime of the webtask; however regenerating 
	        // the webtask will invalidate previously issued JWTs. 
	        return ctx.secrets.WEBTASK_SECRET || req.x_wt.token;
	    };
	    options.getApiKey = options.getApiKey || function (ctx, req) {
	        if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
	            return req.headers.authorization.split(' ')[1];
	        } else if (req.query && req.query.apiKey) {
	            return req.query.apiKey;
	        }
	        return null;
	    };
	    options.loginSuccess = options.loginSuccess || function (ctx, req, res, baseUrl) {
	        res.writeHead(302, { Location: baseUrl + '?apiKey=' + ctx.apiKey });
	        return res.end();
	    };
	    options.loginError = options.loginError || function (error, ctx, req, res, baseUrl) {
	        if (req.method === 'GET') {
	            if (error.redirect) {
	                res.writeHead(302, { Location: error.redirect });
	                return res.end(JSON.stringify(error));
	            }
	            res.writeHead(error.code || 401, { 
	                'Content-Type': 'text/html', 
	                'Cache-Control': 'no-cache' 
	            });
	            return res.end(getNotAuthorizedHtml(baseUrl + '/login'));
	        }
	        else {
	            // Reject all other requests
	            return error(error, res);
	        }            
	    };
	    if (typeof options.authorized === 'string') {
	        options.authorized = [ options.authorized ];
	    }
	    if (Array.isArray(options.authorized)) {
	        var authorized = [];
	        options.authorized.forEach(function (a) {
	            authorized.push(a.toLowerCase());
	        });
	        options.authorized = function (ctx, res) {
	            if (ctx.user.email_verified) {
	                for (var i = 0; i < authorized.length; i++) {
	                    var email = ctx.user.email.toLowerCase();
	                    if (email === authorized[i] || authorized[i][0] === '@' && email.indexOf(authorized[i]) > 1) {
	                        return true;
	                    }
	                }
	            }
	            return false;
	        }
	    }
	    if (typeof options.exclude === 'string') {
	        options.exclude = [ options.exclude ];
	    }
	    if (Array.isArray(options.exclude)) {
	        var exclude = options.exclude;
	        options.exclude = function (ctx, res, appPath) {
	            return exclude.indexOf(appPath) > -1;
	        }
	    }

	    return createAuthenticatedWebtask(webtask, options);
	};

	function createAuthenticatedWebtask(webtask, options) {

	    // Inject middleware into the HTTP pipeline before the webtask handler
	    // to implement authentication endpoints and perform authentication 
	    // and authorization.

	    return function (ctx, req, res) {
	        if (!req.x_wt.jtn || !req.x_wt.container) {
	            return error({
	                code: 400,
	                message: 'Auth0 authentication can only be used with named webtasks.'
	            }, res);
	        }

	        var routingInfo = getRoutingInfo(req);
	        if (!routingInfo) {
	            return error({
	                code: 400,
	                message: 'Error processing request URL path.'
	            }, res);
	        }
	        switch (req.method === 'GET' && routingInfo.appPath) {
	            case '/login': handleLogin(options, ctx, req, res, routingInfo); break;
	            case '/callback': handleCallback(options, ctx, req, res, routingInfo); break;
	            default: handleAppEndpoint(webtask, options, ctx, req, res, routingInfo); break;
	        };
	        return;
	    };
	}

	function getRoutingInfo(req) {
	    var routingInfo = url.parse(req.url, true);
	    var segments = routingInfo.pathname.split('/');
	    if (segments[1] === 'api' && segments[2] === 'run' && segments[3] === req.x_wt.container && segments[4] === req.x_wt.jtn) {
	        // Shared domain case: /api/run/{container}/{jtn}
	        routingInfo.basePath = segments.splice(0, 5).join('/');
	    }
	    else if (segments[1] === req.x_wt.container && segments[2] === req.x_wt.jtn) {
	        // Custom domain case: /{container}/{jtn}
	        routingInfo.basePath = segments.splice(0, 3).join('/');
	    }
	    else {
	        return null;
	    }
	    routingInfo.appPath = '/' + segments.join('/');
	    routingInfo.baseUrl = [
	        req.headers['x-forwarded-proto'] || 'https',
	        '://',
	        req.headers.host,
	        routingInfo.basePath
	    ].join('');
	    return routingInfo;
	}

	var notAuthorizedTemplate = function () {/*
	<!DOCTYPE html5>
	<html>
	  <head>
	    <meta charset="utf-8"/>
	    <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
	    <meta name="viewport" content="width=device-width, initial-scale=1"/>
	    <link href="https://cdn.auth0.com/styleguide/latest/index.css" rel="stylesheet" />
	    <title>Access denied</title>
	  </head>
	  <body>
	    <div class="container">
	      <div class="row text-center">
	        <h1><a href="https://auth0.com" title="Go to Auth0!"><img src="https://cdn.auth0.com/styleguide/1.0.0/img/badge.svg" alt="Auth0 badge" /></a></h1>
	        <h1>Not authorized</h1>
	        <p><a href="##">Try again</a></p>
	      </div>
	    </div>
	  </body>
	</html>
	*/}.toString().match(/[^]*\/\*([^]*)\*\/\s*\}$/)[1];

	function getNotAuthorizedHtml(loginUrl) {
	    return notAuthorizedTemplate.replace('##', loginUrl);
	}


/***/ }),
/* 7 */
/***/ (function(module, exports) {

	module.exports = require("url");

/***/ }),
/* 8 */
/***/ (function(module, exports) {

	module.exports = function (err, res) {
	    res.writeHead(err.code || 500, { 
	        'Content-Type': 'application/json',
	        'Cache-Control': 'no-cache'
	    });
	    res.end(JSON.stringify(err));
	};


/***/ }),
/* 9 */
/***/ (function(module, exports, __webpack_require__) {

	var error = __webpack_require__(8);

	module.exports = function (webtask, options, ctx, req, res, routingInfo) {
	    return options.exclude && options.exclude(ctx, req, routingInfo.appPath)
	        ? run()
	        : authenticate();

	    function authenticate() {
	        var apiKey = options.getApiKey(ctx, req);
	        if (!apiKey) {
	            return options.loginError({
	                code: 401,
	                message: 'Unauthorized.',
	                error: 'Missing apiKey.',
	                redirect: routingInfo.baseUrl + '/login'
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        // Authenticate

	        var secret = options.webtaskSecret(ctx, req);
	        if (!secret) {
	            return error({
	                code: 400,
	                message: 'The webtask secret must be provided to allow for validating apiKeys.'
	            }, res);
	        }

	        try {
	            ctx.user = req.user = __webpack_require__(10).verify(apiKey, secret);
	        }
	        catch (e) {
	            return options.loginError({
	                code: 401,
	                message: 'Unauthorized.',
	                error: e.message
	            }, ctx, req, res, routingInfo.baseUrl);       
	        }

	        ctx.apiKey = apiKey;

	        // Authorize

	        if  (options.authorized && !options.authorized(ctx, req)) {
	            return options.loginError({
	                code: 403,
	                message: 'Forbidden.'
	            }, ctx, req, res, routingInfo.baseUrl);        
	        }

	        return run();
	    }

	    function run() {
	        // Route request to webtask code
	        return webtask(ctx, req, res);
	    }
	};


/***/ }),
/* 10 */
/***/ (function(module, exports) {

	module.exports = require("jsonwebtoken");

/***/ }),
/* 11 */
/***/ (function(module, exports, __webpack_require__) {

	var error = __webpack_require__(8);

	module.exports = function(options, ctx, req, res, routingInfo) {
	    var authParams = {
	        clientId: options.clientId(ctx, req),
	        domain: options.domain(ctx, req)
	    };
	    var count = !!authParams.clientId + !!authParams.domain;
	    var scope = 'openid name email email_verified ' + (options.scope || '');
	    if (count ===  0) {
	        // TODO, tjanczuk, support the shared Auth0 application case
	        return error({
	            code: 501,
	            message: 'Not implemented.'
	        }, res);
	        // Neither client id or domain are specified; use shared Auth0 settings
	        // var authUrl = 'https://auth0.auth0.com/i/oauth2/authorize'
	        //     + '?response_type=code'
	        //     + '&audience=https://auth0.auth0.com/userinfo'
	        //     + '&scope=' + encodeURIComponent(scope)
	        //     + '&client_id=' + encodeURIComponent(routingInfo.baseUrl)
	        //     + '&redirect_uri=' + encodeURIComponent(routingInfo.baseUrl + '/callback');
	        // res.writeHead(302, { Location: authUrl });
	        // return res.end();
	    }
	    else if (count === 2) {
	        // Use custom Auth0 account
	        var authUrl = 'https://' + authParams.domain + '/authorize' 
	            + '?response_type=code'
	            + '&scope=' + encodeURIComponent(scope)
	            + '&client_id=' + encodeURIComponent(authParams.clientId)
	            + '&redirect_uri=' + encodeURIComponent(routingInfo.baseUrl + '/callback');
	        res.writeHead(302, { Location: authUrl });
	        return res.end();
	    }
	    else {
	        return error({
	            code: 400,
	            message: 'Both or neither Auth0 Client ID and Auth0 domain must be specified.'
	        }, res);
	    }
	};


/***/ }),
/* 12 */
/***/ (function(module, exports, __webpack_require__) {

	var error = __webpack_require__(8);

	module.exports = function (options, ctx, req, res, routingInfo) {
	    if (!ctx.query.code) {
	        return options.loginError({
	            code: 401,
	            message: 'Authentication error.',
	            callbackQuery: ctx.query
	        }, ctx, req, res, routingInfo.baseUrl);
	    }

	    var authParams = {
	        clientId: options.clientId(ctx, req),
	        domain: options.domain(ctx, req),
	        clientSecret: options.clientSecret(ctx, req)
	    };
	    var count = !!authParams.clientId + !!authParams.domain + !!authParams.clientSecret;
	    if (count !== 3) {
	        return error({
	            code: 400,
	            message: 'Auth0 Client ID, Client Secret, and Auth0 Domain must be specified.'
	        }, res);
	    }

	    return __webpack_require__(13)
	        .post('https://' + authParams.domain + '/oauth/token')
	        .type('form')
	        .send({
	            client_id: authParams.clientId,
	            client_secret: authParams.clientSecret,
	            redirect_uri: routingInfo.baseUrl + '/callback',
	            code: ctx.query.code,
	            grant_type: 'authorization_code'
	        })
	        .timeout(15000)
	        .end(function (err, ares) {
	            if (err || !ares.ok) {
	                return options.loginError({
	                    code: 502,
	                    message: 'OAuth code exchange completed with error.',
	                    error: err && err.message,
	                    auth0Status: ares && ares.status,
	                    auth0Response: ares && (ares.body || ares.text)
	                }, ctx, req, res, routingInfo.baseUrl);
	            }

	            return issueApiKey(ares.body.id_token);
	        });

	    function issueApiKey(id_token) {
	        var jwt = __webpack_require__(10);
	        var claims;
	        try {
	            claims = jwt.decode(id_token);
	        }
	        catch (e) {
	            return options.loginError({
	                code: 502,
	                message: 'Cannot parse id_token returned from Auth0.',
	                id_token: id_token,
	                error: e.message
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        // Issue apiKey by re-signing the id_token claims 
	        // with configured secret (webtask token by default).

	        var secret = options.webtaskSecret(ctx, req);
	        if (!secret) {
	            return error({
	                code: 400,
	                message: 'The webtask secret must be be provided to allow for issuing apiKeys.'
	            }, res);
	        }

	        claims.iss = routingInfo.baseUrl;
	        req.user = ctx.user = claims;
	        ctx.apiKey = jwt.sign(claims, secret);

	        // Perform post-login action (redirect to /?apiKey=... by default)
	        return options.loginSuccess(ctx, req, res, routingInfo.baseUrl);
	    }
	};


/***/ }),
/* 13 */
/***/ (function(module, exports) {

	module.exports = require("superagent");

/***/ }),
/* 14 */
/***/ (function(module, exports) {

	module.exports = require("boom");

/***/ }),
/* 15 */
/***/ (function(module, exports) {

	module.exports = require("request");

/***/ }),
/* 16 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	var util = __webpack_require__(17);
	var Writable = __webpack_require__(18).Writable;
	var AWS = __webpack_require__(19);
	var hasOwnProperty = Object.prototype.hasOwnProperty;
	var safeStringify = __webpack_require__(20);
	var ONE_DAY = 86400000;
	var MAX_MESSAGE_SIZE = 262118;

	module.exports = CWLogsWritable;

	util.inherits(CWLogsWritable, Writable);

	/**
	 * Writable stream for AWS CloudWatch Logs.
	 *
	 * @constructor
	 * @param {object} options
	 * @param {string} options.logGroupName - AWS CloudWatch [LogGroup](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatchLogs.html#putLogEvents-property) name. It will be created if it doesn't exist.
	 * @param {string} options.logStreamName - AWS CloudWatch [LogStream](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatchLogs.html#putLogEvents-property) name. It will be created if it doesn't exist.
	 * @param {object} [options.cloudWatchLogsOptions={}] - Options passed to [AWS.CloudWatchLogs](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatchLogs.html#constructor-property) service.
	 * @param {string|number} [options.writeInterval=nextTick] - Amount of wait time after a Writable#_write call to allow batching of log events. Must be a positive number or "nextTick". If "nextTick", `process.nextTick` is used. If a number, `setTimeout` is used.
	 * @param {string|number} [options.retryableDelay=150]
	 * @param {number} [options.retryableMax=100] - Maximum number of times an AWS error marked as "retryable" will be retried before the error is instead passed to {@link CWLogsWritable#onError}.
	 * @param {number} [options.maxBatchCount=10000] - Maximum number of log events allowed in a single PutLogEvents API call.
	 * @param {number} [options.maxBatchSize=1048576] - Maximum number of bytes allowed in a single PutLogEvents API call.
	 * @param {boolean} [options.ignoreDataAlreadyAcceptedException=true] - Ignore `DataAlreadyAcceptedException` errors. This will bypass {@link CWLogsWritable#onError}. See [cwlogs-writable/issues/10](https://github.com/amekkawi/cwlogs-writable/issues/10).
	 * @param {boolean} [options.retryOnInvalidSequenceToken=true] - Retry on `InvalidSequenceTokenException` errors. This will bypass {@link CWLogsWritable#onError}. See [cwlogs-writable/issues/12](https://github.com/amekkawi/cwlogs-writable/issues/12).
	 * @param {function} [options.onError] - Called when an AWS error is encountered. Overwrites {@link CWLogsWritable#onError} method.
	 * @param {function} [options.filterWrite] - Filter writes to CWLogsWritable. Overwrites {@link CWLogsWritable#filterWrite} method.
	 * @param {boolean} [options.objectMode=true] - Passed to the Writable constructor. See https://nodejs.org/api/stream.html#stream_object_mode.
	 * @augments {Writable}
	 * @fires CWLogsWritable#putLogEvents
	 * @fires CWLogsWritable#createLogGroup
	 * @fires CWLogsWritable#createLogStream
	 * @fires CWLogsWritable#stringifyError
	 * @example
	 * ```javascript
	 * var CWLogsWritable = require('cwlogs-writable');
	 * var stream = new CWLogsWritable({
	 *   logGroupName: 'my-log-group',
	 *   logStreamName: 'my-stream',
	 *   cloudWatchLogsOptions: {
	 *     region: 'us-east-1',
	 *     accessKeyId: '{AWS-IAM-USER-ACCESS-KEY-ID}',
	 *     secretAccessKey: '{AWS-SECRET-ACCESS-KEY}'
	 *   }
	 * });
	 * ```
	 */
	function CWLogsWritable(options) {
		if (!(this instanceof CWLogsWritable)) {
			return new CWLogsWritable(options);
		}

		this.validateOptions(options);

		Writable.call(this, { objectMode: options.objectMode !== false });

		this._onErrorNextCbId = 1;
		this.sequenceToken = null;
		this.writeQueued = false;

		/**
		 * Logs queued to be sent to AWS CloudWatch Logs. Do not modify directly.
		 *
		 * @protected
		 * @member {Array.<{message:string,timestamp:number}>} CWLogsWritable#queuedLogs
		 */
		this.queuedLogs = [];

		var _logGroupName = options.logGroupName;
		/**
		 * AWS CloudWatch [LogGroup](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatchLogs.html#putLogEvents-property) name.
		 * The LogGroup will be created if it doesn't exist.
		 * Changes to this property will only take affect for the next PutLogEvents API call.
		 *
		 * @member {string} CWLogsWritable#logGroupName
		 */
		Object.defineProperty(this, 'logGroupName', {
			enumerable: true,
			get: function() {
				return _logGroupName;
			},
			set: function(logGroupName) {
				if (logGroupName !== _logGroupName) {
					_logGroupName = logGroupName;
					this.sequenceToken = null;
				}
			}
		});

		var _logStreamName = options.logStreamName;
		/**
		 * AWS CloudWatch [LogStream](http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/CloudWatchLogs.html#putLogEvents-property) name.
		 * The LogStream will be created if it doesn't exist.
		 * Changes to this property will only take affect for the next PutLogEvents API call.
		 *
		 * @member {string} CWLogsWritable#logStreamName
		 */
		Object.defineProperty(this, 'logStreamName', {
			enumerable: true,
			get: function() {
				return _logStreamName;
			},
			set: function(logStreamName) {
				if (logStreamName !== _logStreamName) {
					_logStreamName = logStreamName;
					this.sequenceToken = null;
				}
			}
		});

		/**
		 * Amount of wait time after a Writable#_write call to allow batching of
		 * log events. Must be a positive number or "nextTick".
		 * If "nextTick", `process.nextTick` is used.
		 * If a number, `setTimeout` is used.
		 *
		 * @member {string|number} CWLogsWritable#writeInterval
		 * @default nextTick
		 */
		this.writeInterval = typeof options.writeInterval === 'number'
			? options.writeInterval
			: 'nextTick';

		/**
		 * Ignore `DataAlreadyAcceptedException` errors returned by
		 * [PutLogEvents](http://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html) requests.
		 *
		 * This will bypass {@link CWLogsWritable#onError}.
		 *
		 * See [cwlogs-writable/issues/10](https://github.com/amekkawi/cwlogs-writable/issues/10).
		 *
		 * @member {boolean} CWLogsWritable#ignoreDataAlreadyAcceptedException
		 * @default true
		 */
		this.ignoreDataAlreadyAcceptedException = options.ignoreDataAlreadyAcceptedException !== false;

		/**
		 * Resend log events if
		 * [PutLogEvents](http://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html)
		 * requests return a `InvalidSequenceTokenException` error.
		 *
		 * This will bypass {@link CWLogsWritable#onError}.
		 *
		 * See [cwlogs-writable/issues/12](https://github.com/amekkawi/cwlogs-writable/issues/12).
		 *
		 * @member {boolean} CWLogsWritable#retryOnInvalidSequenceToken
		 * @default true
		 */
		this.retryOnInvalidSequenceToken = options.retryOnInvalidSequenceToken !== false;

		/**
		 * Maximum number of times an AWS error marked as "retryable" will be
		 * retried before the error is instead passed to {@link CWLogsWritable#onError}.
		 *
		 * @member {number} CWLogsWritable#retryableMax
		 * @default 100
		 */
		this.retryableMax = typeof options.retryableMax === 'number'
			? Math.max(0, options.retryableMax)
			: 100;

		/**
		 * @member {string|number} CWLogsWritable#retryableDelay
		 * @default 150
		 */
		this.retryableDelay = options.retryableDelay === 'nextTick' || typeof options.retryableDelay === 'number'
			? options.retryableDelay
			: 150;

		/**
		 * Maximum number of log events allowed in a single PutLogEvents API call.
		 *
		 * @member {number} CWLogsWritable#maxBatchCount
		 * @default 10000
		 */
		this.maxBatchCount = typeof options.maxBatchCount === 'number'
			? Math.min(10000, Math.max(1, options.maxBatchCount))
			: 10000;

		/**
		 * Maximum number of bytes allowed in a single PutLogEvents API call.
		 *
		 * @member {number} CWLogsWritable#maxBatchSize
		 * @default 1048576
		 */
		this.maxBatchSize = typeof options.maxBatchSize === 'number'
			? Math.min(1048576, Math.max(1024, options.maxBatchSize))
			: 1048576;

		if (options.onError) {
			this.onError = options.onError;
		}

		if (options.filterWrite) {
			this.filterWrite = options.filterWrite;
		}

		/**
		 * The AWS.CloudWatchLogs instance.
		 *
		 * @member {CloudWatchLogs} CWLogsWritable#cloudwatch
		 */
		Object.defineProperty(this, 'cloudwatch', {
			enumerable: true,
			writable: false,
			value: this.createService(options.cloudWatchLogsOptions || {})
		});
	}

	/**
	 * Validate the options passed to {@link CWLogsWritable}.
	 *
	 * @protected
	 * @param {object} options
	 * @throws Error
	 */
	CWLogsWritable.prototype.validateOptions = function(options) {
		if (!options || typeof options !== 'object') {
			throw new Error('options must be an object');
		}

		if (typeof options.logGroupName !== 'string') {
			throw new Error('logGroupName option must be a string');
		}

		if (typeof options.logStreamName !== 'string') {
			throw new Error('logStreamName option must be a string');
		}

		if (hasOwnProperty.call(options, 'objectMode') && typeof options.objectMode !== 'boolean') {
			throw new Error('objectMode option must be a boolean, if specified');
		}

		if (hasOwnProperty.call(options, 'writeInterval') && !isInterval(options.writeInterval)) {
			throw new Error('writeInterval option must be a positive number or "nextTick", if specified');
		}

		if (hasOwnProperty.call(options, 'ignoreDataAlreadyAcceptedException') && typeof options.ignoreDataAlreadyAcceptedException !== 'boolean') {
			throw new Error('ignoreDataAlreadyAcceptedException option must be a boolean');
		}

		if (hasOwnProperty.call(options, 'retryOnInvalidSequenceToken') && typeof options.retryOnInvalidSequenceToken !== 'boolean') {
			throw new Error('retryOnInvalidSequenceToken option must be a boolean');
		}

		if (hasOwnProperty.call(options, 'retryableMax') && (!isFiniteNumber(options.retryableMax) || options.retryableMax < 1)) {
			throw new Error('retryableMax option must be a non-zero positive number, if specified');
		}

		if (hasOwnProperty.call(options, 'retryableDelay') && !isInterval(options.retryableDelay)) {
			throw new Error('retryableDelay option must be a positive number or "nextTick", if specified');
		}

		if (hasOwnProperty.call(options, 'maxBatchCount') && (!isFiniteNumber(options.maxBatchCount) || options.maxBatchCount < 1 || options.maxBatchCount > 10000)) {
			throw new Error('maxBatchCount option must be a positive number from 1 to 10000, if specified');
		}

		if (hasOwnProperty.call(options, 'maxBatchSize') && (!isFiniteNumber(options.maxBatchSize) || options.maxBatchSize < 256 || options.maxBatchSize > 1048576)) {
			throw new Error('maxBatchSize option must be a positive number from 256 to 1048576, if specified');
		}

		if (hasOwnProperty.call(options, 'onError') && typeof options.onError !== 'function') {
			throw new Error('onError option must be a function, if specified');
		}

		if (hasOwnProperty.call(options, 'filterWrite') && typeof options.filterWrite !== 'function') {
			throw new Error('filterWrite option must be a function, if specified');
		}
	};

	/**
	 * Get the number of log events queued to be sent to AWS CloudWatch Logs.
	 *
	 * Does not include events that are actively being sent.
	 *
	 * @returns {number}
	 */
	CWLogsWritable.prototype.getQueueSize = function() {
		return this.queuedLogs.length;
	};

	/**
	 * Remove all log events that are still queued.
	 *
	 * @returns {Array.<{message:string,timestamp:number}>} Log events removed from the queue.
	 */
	CWLogsWritable.prototype.clearQueue = function() {
		var oldQueue = this.queuedLogs;
		this.queuedLogs = [];
		return oldQueue;
	};

	/**
	 * Create a log event object from the log record.
	 *
	 * @protected
	 * @param {object|string} rec
	 * @returns {{message: string, timestamp: number}}
	 */
	CWLogsWritable.prototype.createLogEvent = function(rec) {
		return {
			message: typeof rec === 'string'
				? rec
				: this.safeStringifyLogEvent(rec),

			timestamp: typeof rec === 'object' && rec.time
				? new Date(rec.time).getTime()
				: Date.now()
		};
	};

	/**
	 * Safe stringify a log record. Use by {@link CWLogsWritable#createLogEvent}.
	 *
	 * @protected
	 * @param {*} rec
	 * @returns {string}
	 */
	CWLogsWritable.prototype.safeStringifyLogEvent = function(rec) {
		return safeStringify.fastAndSafeJsonStringify(rec);
	};

	/**
	 * Called when an AWS error is encountered. Do not call directly.
	 *
	 * The default behavior of this method is call the `next` argument
	 * with the error as the first argument.
	 *
	 * `logEvents` argument will be either:
	 *
	 * - An array of log event objects (see {@link CWLogsWritable#createLogEvent})
	 *   if error is from PutLogEvents action.
	 * - `null` if error is from any action besides PutLogEvents.
	 *
	 * The `next` argument must be called in one of the following ways:
	 *
	 * - **`next(err)`** — If the first argument is an instance of `Error`, an 'error'
	 *   event will be emitted on the stream, {@link CWLogsWritable#clearQueue} is called,
	 *   and {@link CWLogsWritable#filterWrite} is replaced so no further logging
	 *   will be processed by the stream. This effectively disables the stream.
	 *
	 * - **`next()` or `next(logEvents)`** — The stream will recover from the error and
	 *   resume sending logs to AWS CloudWatch Logs. The first argument may optionally be
	 *   an array of log event objects (i.e. `logEvents` argument) that will be added to
	 *   the head of the log events queue.
	 *
	 * @param {Error} err - AWS error
	 * @param {null|Array.<{message:string,timestamp:number}>} logEvents
	 * @param {function} next
	 * @example
	 * ```javascript
	 * var CWLogsWritable = require('cwlogs-writable');
	 * var stream = new CWLogsWritable({
	 *   logGroupName: 'my-log-group',
	 *   logStreamName: 'my-stream',
	 *   onError: function(err, logEvents, next) {
	 *     if (logEvents) {
	 *       console.error(
	 *         'CWLogsWritable PutLogEvents error',
	 *         err,
	 *         JSON.stringify(logEvents)
	 *       );
	 *
	 *       // Resume without adding the log events back to the queue.
	 *       next();
	 *     }
	 *     else {
	 *       // Use built-in behavior of emitting an error,
	 *       // clearing the queue, and ignoring all writes to the stream.
	 *       next(err);
	 *     }
	 *   }
	 * }).on('error', function(err) {
	 *   // Always listen for 'error' events to catch non-AWS errors as well.
	 *   console.error(
	 *     'CWLogsWritable error',
	 *     err
	 *   );
	 * });
	 * ```
	 */
	CWLogsWritable.prototype.onError = function(err, logEvents, next) {
		next(err);
	};

	/**
	 * Filter writes to CWLogsWritable.
	 *
	 * Default behavior is to return true if `rec` is not null or undefined.
	 *
	 * @param {string|object} rec - Raw log record passed to Writable#write.
	 * @returns {boolean} true to include, and false to exclude.
	 */
	CWLogsWritable.prototype.filterWrite = function(rec) {
		return rec != null;
	};

	/**
	 * Create the AWS.CloudWatchLogs service.
	 *
	 * @protected
	 * @param {object} opts - Passed as first argument to AWS.CloudWatchLogs.
	 * @returns {CloudWatchLogs}
	 */
	CWLogsWritable.prototype.createService = function(opts) {
		return new AWS.CloudWatchLogs(opts);
	};

	/**
	 * Get the next batch of log events to send,
	 * based on the the constraints of PutLogEvents.
	 *
	 * @protected
	 * @see http://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html
	 * @returns {Array.<{message: string, timestamp: number}>}
	 */
	CWLogsWritable.prototype.dequeueNextLogBatch = function() {
		if (!this.queuedLogs.length) {
			return [];
		}

		var batchCount = 1;
		var sizeEstimate = 0;
		var earliestTimestamp = this.queuedLogs[0].timestamp;
		var lastTimestamp = earliestTimestamp;
		var needsSorting = false;
		var dropIndexes = [];

		// Rules for PutLogEvents:
		// (DONE) Log event message cannot be more than 262,118 bytes (256 * 1024 - 26)
		// (DONE) The maximum batch size is 1,048,576 bytes, and this size is calculated as the sum of all event messages in UTF-8, plus 26 bytes for each log event.
		// (SKIP) None of the log events in the batch can be more than 2 hours in the future.
		// (SKIP) None of the log events in the batch can be older than 14 days or the retention period of the log group.
		// (DONE) The log events in the batch must be in chronological ordered by their timestamp (the time the event occurred, expressed as the number of milliseconds since Jan 1, 1970 00:00:00 UTC).
		// (DONE) The maximum number of log events in a batch is 10,000.
		// (DONE) A batch of log events in a single request cannot span more than 24 hours. Otherwise, the operation fails.

		for (var i = 0, l = this.queuedLogs.length; i < l; i++) {
			var dropLogEvent = false;
			var logEvent = this.queuedLogs[i];

			// Cut off if the logs would no longer fit within 24 hours.
			if (logEvent.timestamp > earliestTimestamp + ONE_DAY) {
				break;
			}

			var messageSize = this.getMessageSize(logEvent.message);

			// Handle messages beyond the limit allowed by PutLogEvents.
			if (messageSize > MAX_MESSAGE_SIZE) {
				var reducedMessage = this.reduceOversizedMessage(logEvent.message);

				// Drop the log event if the message could not be reduced.
				if (typeof reducedMessage !== 'string') {
					dropLogEvent = true;
					this._emitOversizeLogEvent(logEvent.message);
				}
				else {
					messageSize = this.getMessageSize(reducedMessage);

					// Drop the log event if the message is still over the limit.
					if (messageSize > MAX_MESSAGE_SIZE) {
						dropLogEvent = true;
						this._emitOversizeLogEvent(logEvent.message);
					}

					// Otherwise, use the now reduced message.
					else {
						logEvent.message = reducedMessage;
					}
				}
			}

			if (dropLogEvent) {
				dropIndexes.push(i);
			}
			else {
				if (lastTimestamp > logEvent.timestamp) {
					needsSorting = true;
				}

				lastTimestamp = logEvent.timestamp;
				sizeEstimate += 26 + messageSize;

				// Cut off at the max bytes limit.
				if (sizeEstimate > this.maxBatchSize || batchCount - dropIndexes.length >= this.maxBatchCount) {
					break;
				}
			}

			batchCount = i + 1;
		}

		var batch;

		// Put all queued items since they fit.
		if (batchCount === this.queuedLogs.length) {
			batch = this.queuedLogs;
			this.queuedLogs = [];
		}

		// Queue just the items that fit within a PutLogEvents call.
		else {
			batch = this.queuedLogs.splice(0, batchCount);
		}

		// Remove any entries that are being dropped.
		if (dropIndexes.length) {
			for (var si = dropIndexes.length - 1; si >= 0; si--) {
				batch.splice(dropIndexes[si], 1);
			}
		}

		if (needsSorting) {
			batch.sort(logEventComparator);
		}

		return batch;
	};

	/**
	 * Get the size of the message in bytes.
	 *
	 * By default this is calculated as the string character length × 4
	 * (UTF-8 characters can have up to 4 bytes), which is cheaper
	 * than determining the exact byte length.
	 *
	 * You may override this method to provide your own implementation
	 * to correctly measure the number of bytes in the string
	 * (i.e. using [Buffer.byteLength()](https://nodejs.org/api/buffer.html#buffer_class_method_buffer_bytelength_string_encoding)).
	 *
	 * @protected
	 * @param {string} message - The "message" prop of a LogEvent.
	 * @returns {number} The size of the message in bytes.
	 */
	CWLogsWritable.prototype.getMessageSize = function(message) {
		// Estimate size assuming each character is 4 bytes.
		var size = message.length * 4;

		// Calculate exact bytes if estimate is over message limit.
		if (size > MAX_MESSAGE_SIZE) {
			size = Buffer.byteLength(message, 'utf8');
		}

		return size;
	};

	/**
	 * Attempt to reduce the specified message so it fits within the
	 * 262118 byte limit enforced by PutLogEvents.
	 *
	 * Only called for messages that are over the byte limit.
	 *
	 * Use [Buffer.byteLength()](https://nodejs.org/api/buffer.html#buffer_class_method_buffer_bytelength_string_encoding)
	 * to accurately measure the message size before returning it.
	 *
	 * If the string returned is still over the byte limit, this method
	 * will _not_ be called again for the log event.
	 *
	 * @see {CWLogsWritable#event:oversizeLogEvent}
	 * @param {string} logEventMessage - Stringified log event.
	 * @returns {*|string} - The reduced string, or a non-string (i.e. undefined or null) indicating the message cannot be reduced.
	 */
	CWLogsWritable.prototype.reduceOversizedMessage = function(logEventMessage) { // eslint-disable-line no-unused-vars
		return null;
	};

	/**
	 * Schedule a call of CWLogsWritable#_sendQueuedLogs to run.
	 *
	 * @private
	 */
	CWLogsWritable.prototype._scheduleSendLogs = function() {
		if (this.writeInterval === 'nextTick') {
			process.nextTick(this._sendLogs.bind(this));
		}
		else {
			setTimeout(this._sendLogs.bind(this), this.writeInterval);
		}
	};

	/**
	 * Internal method called by Writable#_write.
	 *
	 * @param {object|string} record - Logging record. Can be an object if objectMode options is true.
	 * @param {*} _enc - Ignored
	 * @param {function} cb - Always called with no arguments.
	 * @private
	 */
	CWLogsWritable.prototype._write = function _write(record, _enc, cb) {
		// TODO: Also catch errors during filterWrite?
		if (this.filterWrite(record)) {
			// TODO: Handle records that are over (256 * 1024 - 26) bytes, the limit for a CloudWatch Log event minus 26 byte overhead

			try {
				this.queuedLogs.push(this.createLogEvent(record));
			}
			catch (err) {
				err.message = 'Error while stringifying record (install safe-json-stringify to fallback to safer stringification) -- ' + err.message;
				this._emitStringifyError(err, record);
			}

			if (!this.writeQueued) {
				this.writeQueued = true;
				this._scheduleSendLogs();
			}
		}

		cb();
	};

	/**
	 * Send the next batch of log events to AWS CloudWatch Logs.
	 *
	 * @private
	 * @returns {void}
	 */
	CWLogsWritable.prototype._sendLogs = function() {
		var logGroupName = this.logGroupName;
		var logStreamName = this.logStreamName;

		if (this.sequenceToken === null) {
			this._getSequenceToken(logGroupName, logStreamName, function(err, sequenceToken) {
				if (err) {
					this.onError(
						err,
						null,
						this._nextAfterError.bind(this, ++this._onErrorNextCbId)
					);
				}
				else {
					this.sequenceToken = sequenceToken;
					this._sendLogs();
				}
			}.bind(this));
			return;
		}

		if (!this.queuedLogs.length) {
			this.writeQueued = false;
			return;
		}

		var apiParams = {
			logGroupName: this.logGroupName,
			logStreamName: this.logStreamName,
			sequenceToken: this.sequenceToken,
			logEvents: this.dequeueNextLogBatch()
		};

		this._putLogEvents(apiParams, function(err, sequenceToken) {
			if (err) {
				this._onErrorNextCbId++;

				if (err.code === 'InvalidSequenceTokenException' && this.retryOnInvalidSequenceToken) {
					this._nextAfterError(this._onErrorNextCbId, apiParams.logEvents);
				}

				else if (err.code === 'DataAlreadyAcceptedException' && this.ignoreDataAlreadyAcceptedException) {
					this._nextAfterError(this._onErrorNextCbId);
				}

				else {
					this.onError(
						err,
						apiParams.logEvents,
						this._nextAfterError.bind(this, this._onErrorNextCbId)
					);
				}
			}
			else {
				this.sequenceToken = sequenceToken;
				this._emitPutLogEvents(apiParams.logEvents);

				if (this.queuedLogs.length) {
					this._scheduleSendLogs();
				}
				else {
					this.writeQueued = false;
				}
			}
		}.bind(this));
	};

	/**
	 * Attempt to continue sending log events to AWS CloudWatch Logs after an error was previously returned.
	 *
	 * @param {number} _onErrorNextCbId - Internal ID used to prevent multiple calls.
	 * @param {Error|Array.<{message:string,timestamp:number}>} [errOrLogEvents] - The log events that failed to send, which will be returned to the beginning of the queue.
	 * @private
	 */
	CWLogsWritable.prototype._nextAfterError = function(_onErrorNextCbId, errOrLogEvents) {
		// Abort if not the current 'next' callback.
		if (this._onErrorNextCbId !== _onErrorNextCbId) {
			return;
		}

		// Increment to prevent calling again.
		this._onErrorNextCbId++;

		// Reset sequence token since we don't know if it's accurate anymore
		this.sequenceToken = null;

		if (errOrLogEvents instanceof Error) {
			this._handleError(errOrLogEvents);
			return;
		}

		if (errOrLogEvents) {
			// Return the log events to the beginning of the queue
			if (this.queuedLogs.length) {
				this.queuedLogs = errOrLogEvents.concat(this.queuedLogs);
			}
			else {
				this.queuedLogs = errOrLogEvents;
			}
		}

		this._scheduleSendLogs();
	};

	/**
	 * Handle a critial error. This effectively disables the stream.
	 *
	 * @param {Error} err
	 * @private
	 */
	CWLogsWritable.prototype._handleError = function(err) {
		// Only throw error if there are listeners.
		// See https://nodejs.org/docs/latest-v4.x/api/events.html#events_emitter_listenercount_eventname
		if (this.listeners('error').length) {
			this.emit('error', err);
		}

		this.clearQueue();
		this.filterWrite = CWLogsWritable._falseFilterWrite;
	};

	/**
	 * Send a PutLogEvents action to AWS.
	 *
	 * @param {object} apiParams
	 * @param {function} cb
	 * @private
	 */
	CWLogsWritable.prototype._putLogEvents = function(apiParams, cb) {
		var retries = 0;
		var retryableDelay = this.retryableDelay;
		var retryableMax = this.retryableMax;
		var cloudwatch = this.cloudwatch;

		attemptPut();

		function attemptPut() {
			cloudwatch.putLogEvents(apiParams, function(err, res) {
				if (err) {
					if (err.retryable && retryableMax > retries++) {
						if (retryableDelay === 'nextTick') {
							process.nextTick(attemptPut);
						}
						else {
							setTimeout(attemptPut, retryableDelay);
						}
					}
					else {
						cb(err);
					}
				}
				else {
					cb(null, res.nextSequenceToken);
				}
			});
		}
	};

	/**
	 * Describe the LogStream in AWS CloudWatch Logs to get the next sequence token.
	 *
	 * @param {string} logGroupName
	 * @param {string} logStreamName
	 * @param {function} cb
	 * @private
	 */
	CWLogsWritable.prototype._getSequenceToken = function(logGroupName, logStreamName, cb) {
		this.cloudwatch.describeLogStreams({
			logGroupName: logGroupName,
			logStreamNamePrefix: logStreamName
		}, function(err, data) {
			if (err) {
				if (err.name === 'ResourceNotFoundException') {
					this._createLogGroupAndStream(logGroupName, logStreamName, function(err) {
						if (err) {
							cb(err);
						}
						else {
							this._getSequenceToken(logGroupName, logStreamName, cb);
						}
					}.bind(this));
				}
				else {
					cb(err);
				}
			}
			else if (data.logStreams.length === 0) {
				this._createLogStream(logGroupName, logStreamName, function(err) {
					if (err) {
						cb(err);
					}
					else {
						this._emitCreateLogStream();
						this._getSequenceToken(logGroupName, logStreamName, cb);
					}
				}.bind(this));
			}
			else {
				cb(null, data.logStreams[0].uploadSequenceToken);
			}
		}.bind(this));
	};

	/**
	 * Create both the LogGroup and LogStream in AWS CloudWatch Logs.
	 *
	 * @param {string} logGroupName
	 * @param {string} logStreamName
	 * @param {function} cb
	 * @private
	 */
	CWLogsWritable.prototype._createLogGroupAndStream = function(logGroupName, logStreamName, cb) {
		this._createLogGroup(logGroupName, function(err) {
			if (err) {
				cb(err);
			}
			else {
				this._emitCreateLogGroup();
				this._createLogStream(logGroupName, logStreamName, function(err) {
					if (err) {
						cb(err);
					}
					else {
						this._emitCreateLogStream();
						cb();
					}
				}.bind(this));
			}
		}.bind(this));
	};

	/**
	 * Create the LogGroup in AWS CloudWatch Logs.
	 *
	 * @param {string} logGroupName
	 * @param {function} cb
	 * @private
	 */
	CWLogsWritable.prototype._createLogGroup = function(logGroupName, cb) {
		this.cloudwatch.createLogGroup({
			logGroupName: logGroupName
		}, cb);
	};

	/**
	 * Create the LogStream in AWS CloudWatch Logs.
	 *
	 * @param {string} logGroupName
	 * @param {string} logStreamName
	 * @param {function} cb
	 * @private
	 */
	CWLogsWritable.prototype._createLogStream = function(logGroupName, logStreamName, cb) {
		this.cloudwatch.createLogStream({
			logGroupName: logGroupName,
			logStreamName: logStreamName
		}, cb);
	};

	/**
	 * Fired on successful PutLogEvent API calls.
	 *
	 * @event CWLogsWritable#putLogEvents
	 * @param {Array.<{message:string,timestamp:number}>} logEvents
	 */
	CWLogsWritable.prototype._emitPutLogEvents = function(logEvents) {
		this.emit('putLogEvents', logEvents);
	};

	/**
	 * Fired on successful CreateLogGroup API call.
	 *
	 * @event CWLogsWritable#createLogGroup
	 */
	CWLogsWritable.prototype._emitCreateLogGroup = function() {
		this.emit('createLogGroup');
	};

	/**
	 * Fired on successful CreateLogStream API call.
	 *
	 * @event CWLogsWritable#createLogStream
	 */
	CWLogsWritable.prototype._emitCreateLogStream = function() {
		this.emit('createLogStream');
	};

	/**
	 * Fired when an error is thrown while stringifying a log event.
	 *
	 * @event CWLogsWritable#stringifyError
	 * @param {Error} err
	 * @param {object|string} rec
	 */
	CWLogsWritable.prototype._emitStringifyError = function(err, rec) {
		this.emit('stringifyError', err, rec);
	};

	/**
	 * Fired when a log event message is larger than the 262118 byte limit enforced by PutLogEvents.
	 *
	 * @event CWLogsWritable#oversizeLogEvent
	 * @param {string} logEventMessage - Stringified log event.
	 */
	CWLogsWritable.prototype._emitOversizeLogEvent = function(logEventMessage) {
		this.emit('oversizeLogEvent', logEventMessage);
	};

	CWLogsWritable._falseFilterWrite = function() {
		return false;
	};

	function isFiniteNumber(val) {
		return typeof val === 'number' && isFinite(val);
	}

	function isInterval(val) {
		return val === 'nextTick' || isFiniteNumber(val) && val >= 0;
	}

	function logEventComparator(a, b) {
		return a.timestamp < b.timestamp ? -1
			: a.timestamp > b.timestamp ? 1 : 0;
	}


/***/ }),
/* 17 */
/***/ (function(module, exports) {

	module.exports = require("util");

/***/ }),
/* 18 */
/***/ (function(module, exports) {

	module.exports = require("stream");

/***/ }),
/* 19 */
/***/ (function(module, exports) {

	module.exports = require("aws-sdk");

/***/ }),
/* 20 */
/***/ (function(module, exports, __webpack_require__) {

	'use strict';

	// Variation of safe circular stringification code from
	// https://github.com/trentm/node-bunyan

	var safeJsonStringify;
	try {
		safeJsonStringify = __webpack_require__(21);
	}
	catch (e) {
		safeJsonStringify = null;
	}

	// A JSON stringifier that handles cycles safely - tracks seen values in a Set.
	function safeCyclesSet() {
		var seen = new Set(); // eslint-disable-line no-undef
		return function(key, val) {
			if (!val || typeof val !== 'object') {
				return val;
			}
			if (seen.has(val)) {
				return '[Circular]';
			}
			seen.add(val);
			return val;
		};
	}

	/**
	 * A JSON stringifier that handles cycles safely - tracks seen vals in an Array.
	 *
	 * Note: This approach has performance problems when dealing with large objects,
	 * see trentm/node-bunyan#445, but since this is the only option for node 0.10
	 * and earlier (as Set was introduced in Node 0.12), it's used as a fallback
	 * when Set is not available.
	 *
	 * @private
	 * @returns {function}
	 */
	function safeCyclesArray() {
		var seen = [];
		return function(key, val) {
			if (!val || typeof val !== 'object') {
				return val;
			}
			if (seen.indexOf(val) !== -1) {
				return '[Circular]';
			}
			seen.push(val);
			return val;
		};
	}

	/* istanbul ignore next: Ignoring compat condition to better track reduction in coverage %  */
	/**
	 * A JSON stringifier that handles cycles safely.
	 *
	 * Usage: JSON.stringify(obj, safeCycles())
	 *
	 * Choose the best safe cycle function from what is available - see
	 * trentm/node-bunyan#445.
	 *
	 * @private
	 */
	var safeCycles = typeof Set !== 'undefined'
		? safeCyclesSet
		: safeCyclesArray;

	/**
	 * A fast JSON.stringify that handles cycles and getter exceptions (when
	 * safeJsonStringify is installed).
	 *
	 * This function attempts to use the regular JSON.stringify for speed, but on
	 * error (e.g. JSON cycle detection exception) it falls back to safe stringify
	 * handlers that can deal with cycles and/or getter exceptions.
	 *
	 * @private
	 * @param {*} rec
	 * @returns {string}
	 */
	function fastAndSafeJsonStringify(rec) {
		try {
			return JSON.stringify(rec);
		}
		catch (ex) {
			try {
				return JSON.stringify(rec, safeCycles());
			}
			catch (e) {
				if (safeJsonStringify) {
					return safeJsonStringify(rec);
				}
				else {
					throw e;
				}
			}
		}
	}

	exports.safeCycles = safeCycles;
	exports._safeCyclesSet = safeCyclesSet;
	exports._safeCyclesArray = safeCyclesArray;
	exports.fastAndSafeJsonStringify = fastAndSafeJsonStringify;


/***/ }),
/* 21 */
/***/ (function(module, exports) {

	var hasProp = Object.prototype.hasOwnProperty;

	function throwsMessage(err) {
		return '[Throws: ' + (err ? err.message : '?') + ']';
	}

	function safeGetValueFromPropertyOnObject(obj, property) {
		if (hasProp.call(obj, property)) {
			try {
				return obj[property];
			}
			catch (err) {
				return throwsMessage(err);
			}
		}

		return obj[property];
	}

	function ensureProperties(obj) {
		var seen = [ ]; // store references to objects we have seen before

		function visit(obj) {
			if (obj === null || typeof obj !== 'object') {
				return obj;
			}

			if (seen.indexOf(obj) !== -1) {
				return '[Circular]';
			}
			seen.push(obj);

			if (typeof obj.toJSON === 'function') {
				try {
					return visit(obj.toJSON());
				} catch(err) {
					return throwsMessage(err);
				}
			}

			if (Array.isArray(obj)) {
				return obj.map(visit);
			}

			return Object.keys(obj).reduce(function(result, prop) {
				// prevent faulty defined getter properties
				result[prop] = visit(safeGetValueFromPropertyOnObject(obj, prop));
				return result;
			}, {});
		};

		return visit(obj);
	}

	module.exports = function(data, replacer, space) {
		return JSON.stringify(ensureProperties(data), replacer, space);
	}

	module.exports.ensureProperties = ensureProperties;


/***/ }),
/* 22 */
/***/ (function(module, exports) {

	module.exports = require("uuid");

/***/ }),
/* 23 */
/***/ (function(module, exports) {

	module.exports = require("lru-memoizer");

/***/ })
/******/ ]);
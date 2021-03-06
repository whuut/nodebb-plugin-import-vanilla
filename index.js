
var async = require('async');
var mysql = require('mysql');
var _ = require('underscore');
var noop = function(){};
var logPrefix = '[nodebb-plugin-import-vanilla]';

(function(Exporter) {

    Exporter.setup = function(config, callback) {
        Exporter.log('setup');

        // mysql db only config
        // extract them from the configs passed by the nodebb-plugin-import adapter
        var _config = {
            host: config.dbhost || config.host || 'localhost',
            user: config.dbuser || config.user || 'root',
            password: config.dbpass || config.pass || config.password || '',
            port: config.dbport || config.port || 3306,
            database: config.dbname || config.name || config.database || 'vanilla'
        };

        Exporter.config(_config);
        Exporter.config('prefix', config.prefix || config.tablePrefix || 'GDN_');

        if (config.custom && typeof config.custom === 'string') {
            try {
                config.custom = JSON.parse(config.custom)
            } catch (e) {
                config.custom = null
            }
        }

        Exporter.config('custom', config.custom || {
            'kudosEnabled': false
        });

        Exporter.connection = mysql.createConnection(_config);
        Exporter.connection.connect();

        callback(null, Exporter.config());
    };

    Exporter.getUsers = function(callback) {
        return Exporter.getPaginatedUsers(0, -1, callback);
    };
    Exporter.getPaginatedUsers = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + 'tblUser.UserID AS _uid, '
            + 'tblUser.Name AS _username, '
            // + 'tblUser.USER_DISPLAY_NAME AS _alternativeUsername, '
            + 'tblUser.Email AS _registrationEmail, '
            + 'if (tblUser.Admin = 1, "administrator", "") AS _level, '
            + 'UNIX_TIMESTAMP(tblUser.DateFirstVisit) AS _joindate, '
            + 'tblUser.Banned AS _banned, '
            + 'tblUser.Email AS _email, '
            // + prefix + 'USER_PROFILE.USER_SIGNATURE AS _signature, '
            // + prefix + 'USER_PROFILE.USER_HOMEPAGE AS _website, '
            // + prefix + 'USER_PROFILE.USER_OCCUPATION AS _occupation, '
            // + prefix + 'USER_PROFILE.USER_LOCATION AS _location, '
            + 'CONCAT(\'/uploads/profile/\', tblUser.Photo) AS _picture, '
            // + prefix + 'USER_PROFILE.USER_TITLE AS _title, '
            + 'tblUser.ShowEmail AS _showemail, '
            + 'UNIX_TIMESTAMP(tblUser.DateLastActive) AS _lastposttime, ' // approximate
            + '(SELECT GROUP_CONCAT(d.DiscussionID) FROM ' + prefix + 'Discussion d JOIN ' + prefix + 'UserDiscussion ud ON (d.DiscussionID = ud.DiscussionID) WHERE ud.DateLastViewed >= d.dateLastComment AND ud.UserID = tblUser.UserID) as _readTids, '
            // count both discussions and Comments AS posts
            + '(tblUser.CountDiscussions + tblUser.CountComments) AS _postcount, '
            + 'DATE_FORMAT(tblUser.DateOfBirth, "%m/%d/%Y") AS _birthday ' // format: mm/dd/yyyy
            + 'FROM ' + prefix + 'User AS tblUser ' //+ prefix + 'USER_PROFILE '
            + 'WHERE tblUser.Deleted = 0 '
            // + 'WHERE ' + prefix + 'USERS.USER_ID = ' + prefix + 'USER_PROFILE.USER_ID '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // console.log ('Users query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    // nbb forces signatures to be less than 150 chars
                    // keeping it HTML see https://github.com/akhoury/nodebb-plugin-import#markdown-note
                    row._signature = Exporter.truncateStr(row._signature || '', 150);

                    // from unix timestamp (s) to JS timestamp (ms)
                    row._joindate = ((row._joindate || 0) * 1000) || startms;

                    // lower case the email for consistency
                    row._email = (row._email || '').toLowerCase();

                    row._picture = getActualProfilePath(row._picture);
                    row._website = Exporter.validateUrl(row._website);
                    row._readTids = row._readTids ? row._readTids.split(',').map(function(tidStr){ return parseInt(tidStr); }) : [];

                    map[row._uid] = row;
                });

                callback(null, map);
            });
    };

    // Vanilla does this annoying thing where they change the filename based on the context. This uses
    // the smallest version (prepended with an 'n', since I found that one to be most consistent.
    // Resolution might suffer
    var getActualProfilePath = function(path) {
        // return empty string if e.g. GDN_User.Photo is NULL
        if (!path)
            return "";
        // probably won't work on windows
        var lastSlash = path.lastIndexOf('/') + 1;
        return path.substring(0, lastSlash) + 'n' + path.substring(lastSlash);
    };

    Exporter.getCategories = function(callback) {
        return Exporter.getPaginatedCategories(0, -1, callback);
    };
    Exporter.getPaginatedCategories = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query = 'SELECT '
            + 'tblCategory.CategoryID AS _cid, '
            + 'tblCategory.Name AS _name, '
            + 'tblCategory.Description AS _description, '
            + 'UNIX_TIMESTAMP(tblCategory.DateInserted) AS _timestamp '
            + 'FROM ' + prefix + 'Category AS tblCategory '
            + 'WHERE tblCategory.CategoryID > -1 ' // GDN has a root category with id -1 we don't use
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');


        // console.log ('Categories query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._name = row._name || 'Untitled Category '
                    row._description = row._description || 'No description available';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;

                    map[row._cid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getRooms = function(callback) {
        return Exporter.getPaginatedRooms(0, -1, callback);
    };
    Exporter.getPaginatedRooms = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query =
            'SELECT '
            + 'tblRooms.ConversationID AS _roomId, '

            + 'tblRooms.InsertUserID AS _uid, '
            + 'tblRooms.Contributors AS _uids, '
            + 'UNIX_TIMESTAMP(tblRooms.DateInserted) AS _timestamp '

            + 'FROM ' + prefix + 'Conversation AS tblRooms '// + prefix + ', Comment AS tblPosts '

            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // console.log ('Topics query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};

                rows.forEach(function(row) {
                    // this is a really terrible hack and I'm not sure it will work for all communities
                    // the Contributors column is formatted as such: 'a:3:{i:0;s:1:"1";i:1;s:1:"2";i:2;s:2:"10";}'
                    // so, contributors are denoted as 's:<some var>:"<contributor uid>"' and this is how to extract it:
                    row._uids = row._uids.split(';')
                        .filter(function(s){return s[0] === 's';})  // only return elements starting with 's'
                        .map(function(s){                           // then split by ':', getting the third element
                            return parseInt(s.split(':')[2].replace('"','')); // which is a string containing quotes, and parse to int.
                        });
                    row._roomName = 'Chat Room ' + row._roomId;
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    map[row._roomId] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getMessages = function(callback) {
        return Exporter.getPaginatedMessages(0, -1, callback);
    };
    Exporter.getPaginatedMessages = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query =
            'SELECT '
            + 'tblMessages.MessageID AS _mid, '

            + 'tblMessages.ConversationID AS _roomId, '

            + 'tblMessages.InsertUserID AS _fromuid, '
            + 'tblMessages.Body AS _content, '
            + 'UNIX_TIMESTAMP(tblMessages.DateInserted) AS _timestamp '

            + 'FROM ' + prefix + 'ConversationMessage AS tblMessages '// + prefix + ', Comment AS tblPosts '

            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // console.log ('Messages query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};

                rows.forEach(function(row) {
                    row._title = row._title ? row._title[0].toUpperCase() + row._title.substr(1) : 'Untitled';
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    map[row._mid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getTopics = function(callback) {
        return Exporter.getPaginatedTopics(0, -1, callback);
    };
    Exporter.getPaginatedTopics = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');

        var custom = Exporter.config('custom');
        var importAttachments = custom && custom.importAttachments;

        var startms = +new Date();
        var query =
            'SELECT '
             + 'tblTopics.DiscussionID AS _tid, '

            // aka category id, or cid
             + 'tblTopics.CategoryID AS _cid, '

            // this is the 'parent-post'
            // see https://github.com/akhoury/nodebb-plugin-import#important-note-on-topics-and-posts
            // I don't really need it since I just do a simple join and get its content, but I will include for the reference
            // remember: this post is EXCLUDED in the getPosts() function
            //  + 'tblTopics.POST_ID AS _pid, ' // Don't need this for Vanilla

             + 'tblTopics.InsertUserID AS _uid, '
             + 'tblTopics.CountViews AS _viewcount, '
             + 'tblTopics.Name AS _title, '
             + 'UNIX_TIMESTAMP(tblTopics.DateInserted) AS _timestamp, '
             + 'UNIX_TIMESTAMP(tblTopics.DateUpdated) AS _edited, '

            // maybe use that to skip
            //  + 'tblTopics.TOPIC_IS_APPROVED AS _approved, '

            // todo:  figure out what this means,
            //  + 'tblTopics.TOPIC_STATUS AS _status, '  // don't need this

             + 'tblTopics.Announce AS _pinned, ';
             if (importAttachments) {
                query += '(SELECT GROUP_CONCAT(CONCAT("/uploads/files", media.Path)) from GDN_Media AS media WHERE media.ForeignID = tblTopics.DiscussionID AND media.Type LIKE "image%" AND media.ForeignTable = "discussion") AS _images, '
                 + '(SELECT GROUP_CONCAT(CONCAT("/uploads/files", media.Path)) from GDN_Media AS media WHERE media.ForeignID = tblTopics.DiscussionID AND media.Type NOT LIKE "image%" AND media.ForeignTable = "discussion") AS _attachments, '
             }

            // I dont need it, but if it should be 0 per UBB logic, since this post is not replying to anything, it's the parent-post of the topic
            //  + 'tblPosts.POST_PARENT_ID AS _post_replying_to, '

            // this should be == to the _tid on top of this query
            //  + 'tblPosts.DiscussionID AS _post_tid, '

            query += 'tblTopics.Body AS _content '

            + 'FROM ' + prefix + 'Discussion AS tblTopics '
            // see
            // + 'WHERE tblTopics.TOPIC_ID = tblPosts.TOPIC_ID '
            // and this one must be a parent
            // + 'AND '  + 'tblPosts.POST_PARENT_ID=0 '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // Exporter.log ('Topics query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};

                rows.forEach(function(row) {
                    row._title = row._title ? row._title[0].toUpperCase() + row._title.substr(1) : 'Untitled';
                    row._images = row._images ? row._images.split(',') : [];
                    row._attachments = row._attachments ? row._attachments.split(',') : [];
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    map[row._tid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getPosts = function(callback) {
        return Exporter.getPaginatedPosts(0, -1, callback);
    };
    Exporter.getPaginatedPosts = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var err;
        var prefix = Exporter.config('prefix');

        var custom = Exporter.config('custom');
        var importAttachments = custom && custom.importAttachments;

        var startms = +new Date();
        var query =
            'SELECT '
            + 'tblPosts.CommentID AS _pid, '
            + 'tblPosts.DiscussionID AS _post_replying_to, '
            + 'tblPosts.DiscussionID AS _tid, '
            + 'UNIX_TIMESTAMP(tblPosts.DateInserted) AS _timestamp, '
            + 'UNIX_TIMESTAMP(tblPosts.DateUpdated) AS _edited, '
            // + 'tblPosts.
            // not being used
            // + 'tblPosts.POST_SUBJECT AS _subject, '

            + 'tblPosts.Body AS _content, '
            + 'tblPosts.InsertUserID AS _uid, ';
            if (importAttachments) {
                query += '(SELECT GROUP_CONCAT(CONCAT("/uploads/files", media.Path)) from ' + prefix + 'Media AS media WHERE media.ForeignID = tblPosts.CommentID AND media.Type LIKE "image%" AND media.ForeignTable = "comment") AS _images, '
                + '(SELECT GROUP_CONCAT(CONCAT("/uploads/files", media.Path)) from ' + prefix + 'Media AS media WHERE media.ForeignID = tblPosts.CommentID AND media.Type NOT LIKE "image%" AND media.ForeignTable = "comment") AS _attachments, '
            }

            // I couldn't tell what's the different, they're all HTML to me
            query += 'tblPosts.Format AS _markup ' // TODO have to convert this one to markup?, val is "html"

            // maybe use this one to skip
            // + 'tblPosts.POST_IS_APPROVED AS _approved '

            + 'FROM ' + prefix + 'Comment AS tblPosts ORDER BY DateInserted '
            // this post cannot be a its topic's main post, it MUST be a reply-post
            // see https://github.com/akhoury/nodebb-plugin-import#important-note-on-topics-and-posts
            // + 'WHERE POST_PARENT_ID > 0 '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // Exporter.log ('Posts query is: ' + query);


        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize here
                var map = {};
                rows.forEach(function(row) {
                    row._content = row._content || '';
                    row._images = row._images ? row._images.split(',') : [];
                    row._attachments = row._attachments ? row._attachments.split(',') : [];
                    row._timestamp = ((row._timestamp || 0) * 1000) || startms;
                    map[row._pid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getVotes = function(callback) {
        return Exporter.getPaginatedVotes(0, -1, callback);
    };
    Exporter.getPaginatedVotes = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var custom = Exporter.config('custom');
        var kudosEnabled = custom && custom.importKudos;

        if (!kudosEnabled) {
            Exporter.warn('skipping votes import (enable with {"importKudos":true})');
            callback(null, {});
            return;
        }

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query =
            'SELECT '
            + 'CONCAT(IFNULL(tblVotes.CommentID, "N"), "_", IFNULL(tblVotes.DiscussionID, "N"), "_", tblVotes.UserID) AS _vid, ' // no unique id, so had to make a composite key
            + 'tblVotes.CommentID AS _pid, '
            + 'tblVotes.DiscussionID AS _tid, '
            + 'tblVotes.UserID AS _uid, '
            + 'IF(tblVotes.Action = 2, -1, 1) AS _action '
            + 'FROM ' + prefix + 'Kudos AS tblVotes '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // console.log('Votes query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize votes here
                var map = {};
                rows.forEach(function(row) {
                    map[row._vid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.getBookmarks = function(callback) {
        return Exporter.getPaginatedVotes(0, -1, callback);
    };
    Exporter.getPaginatedBookmarks = function(start, limit, callback) {
        callback = !_.isFunction(callback) ? noop : callback;

        var custom = Exporter.config('custom');
        var importBookmarks = custom && custom.importBookmarks;

        if (!importBookmarks) {
            Exporter.warn('skipping bookmarks import (enable with {"importBookmarks": true}');
            callback(null, {});
            return;
        }

        var err;
        var prefix = Exporter.config('prefix');
        var startms = +new Date();
        var query =
            'SELECT '
            + 'CONCAT(tblBookmarks.UserID, "_", tblBookmarks.DiscussionID) AS _bid, ' // no unique id, so had to make a composite key
            + 'tblBookmarks.DiscussionID AS _tid, '
            + 'tblBookmarks.UserID AS _uid, '
            + 'tblBookmarks.CountComments AS _index '
            + 'FROM ' + prefix + 'UserDiscussion AS tblBookmarks '
            + (start >= 0 && limit >= 0 ? 'LIMIT ' + start + ',' + limit : '');

        // console.log('Bookmarks query is: ' + query);

        if (!Exporter.connection) {
            err = {error: 'MySQL connection is not setup. Run setup(config) first'};
            Exporter.error(err.error);
            return callback(err);
        }

        Exporter.connection.query(query,
            function(err, rows) {
                if (err) {
                    Exporter.error(err);
                    return callback(err);
                }

                //normalize votes here
                var map = {};
                rows.forEach(function(row) {
                    map[row._bid] = row;
                });

                callback(null, map);
            });
    };

    Exporter.teardown = function(callback) {
        Exporter.log('teardown');
        Exporter.connection.end();

        Exporter.log('Done');
        callback();
    };

    Exporter.testrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getUsers(next);
            },
            function(next) {
                Exporter.getCategories(next);
            },
            function(next) {
                Exporter.getTopics(next);
            },
            function(next) {
                Exporter.getPosts(next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.paginatedTestrun = function(config, callback) {
        async.series([
            function(next) {
                Exporter.setup(config, next);
            },
            function(next) {
                Exporter.getPaginatedUsers(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedCategories(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedTopics(0, 1000, next);
            },
            function(next) {
                Exporter.getPaginatedPosts(1001, 2000, next);
            },
            function(next) {
                Exporter.teardown(next);
            }
        ], callback);
    };

    Exporter.warn = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.warn.apply(console, args);
    };

    Exporter.log = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.log.apply(console, args);
    };

    Exporter.error = function() {
        var args = _.toArray(arguments);
        args.unshift(logPrefix);
        console.error.apply(console, args);
    };

    Exporter.config = function(config, val) {
        if (config != null) {
            if (typeof config === 'object') {
                Exporter._config = config;
            } else if (typeof config === 'string') {
                if (val != null) {
                    Exporter._config = Exporter._config || {};
                    Exporter._config[config] = val;
                }
                return Exporter._config[config];
            }
        }
        return Exporter._config;
    };

    // from Angular https://github.com/angular/angular.js/blob/master/src/ng/directive/input.js#L11
    Exporter.validateUrl = function(url) {
        var pattern = /^(ftp|http|https):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?$/;
        return url && url.length < 2083 && url.match(pattern) ? url : '';
    };

    Exporter.truncateStr = function(str, len) {
        if (typeof str != 'string') return str;
        len = _.isNumber(len) && len > 3 ? len : 20;
        return str.length <= len ? str : str.substr(0, len - 3) + '...';
    };

    Exporter.whichIsFalsy = function(arr) {
        for (var i = 0; i < arr.length; i++) {
            if (!arr[i])
                return i;
        }
        return null;
    };

})(module.exports);

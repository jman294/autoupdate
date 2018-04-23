var async = require('async');
var _ = require('lodash');
var path = require('path');
var cdnjs = require('./cdnjs');
var fs = require('fs-extra');
var stable = require('semver-stable');
var compareVersions = require('compare-versions');
var colors = require('colors');
var rp = require('request-promise');
var minimatch = require('minimatch');

var update = function (library, callback) {
  var userAgent = 'CDNJS GitHub auto-updater';

  async.series([
      function (next) {
        rp({
          uri: 'https://api.github.com/repos/'
            + githubRepo(library.autoupdate.target) + '/tags',
          headers: {
            'User-Agent': userAgent
          }
        })
        .then(function (string) {
          var response = JSON.parse(string);
          var versions = _.map(response, function (tag) {
            return { version: tag.name, tree: tag.commit.sha };
          });

          var needed = _.filter(versions, function (version) {
            var tagName = versions[0].version;
            if ((tagName === 'v' || tagName === 'V' || tagName === 'r') &&
                  version.length > 1 && !isNaN(version[1])) {
              version.version = version.version.substr(1);
            }

            return (!cdnjs.checkVersion(library, version.version) && /\d+/.test(version.version));
          });

          if (needed.length > 0) {
            console.log(library.name, 'needs versions:', needed.join(', ').blue);
          }

          async.eachSeries(needed, function (tag, callback) {
            var fullData = tag;
            tag = tag.version;
            if ((tag[0] === 'v' || tag[0] === 'V' || tag[0] === 'r') &&
                  tag.length > 1 && !isNaN(tag[1])) {
              tag = tag.substr(1);
            }

            var basePath = library.autoupdate.basePath || '';
            var allFiles = [];

            rp({
              uri: 'https://api.github.com/repos/'
                + githubRepo(library.autoupdate.target) + '/git/trees/'
                + fullData.tree + '?recursive=1',
              headers: {
                'User-Agent': userAgent
              }
            })
            .then(function (jsonString) {
              var filesJson = JSON.parse(jsonString);
              _.each(library.autoupdate.fileMap, function (mapGroup) {
                var cBasePath = mapGroup.basePath || '';
                var files = [];
                _.each(mapGroup.files, function (cRule) {
                  var newFiles = [];
                  for (var file of filesJson.tree) {
                    if (file.path.indexOf(cBasePath) === 0) {
                      if (minimatch(file.path, cRule, {
                        nodir: true,
                        realpath: true
                      })) {
                        newFiles.push({ path: file.path, tree: fullData.tree });
                      }
                    }
                  }

                  files = files.concat(newFiles);
                  if (newFiles.length === 0) {
                    console.log('Not found'.red, cRule.cyan, tag);
                    fs.mkdirsSync(path.normalize(
                      path.join(__dirname, '../../cdnjs', 'ajax', 'libs', library.name, tag)));
                  }
                });

                allFiles = allFiles.concat(files.map(function (c) {
                  return {
                    _: c.path,
                    basePath: cBasePath,
                    tree: c.tree
                  };
                }));
              });

              console.log('All files for ' + library.name + ' v' + tag, '-', allFiles.length);
              library.version = library.version || '0.0.0';
              var greaterVer;
              try {
                greaterVer = compareVersions(tag, library.version) > 0;
              } catch (e) {
                greaterVer = false;
              }

              if ((allFiles.length !== 0) &&
                  ((!library.version) ||
                  ((greaterVer) &&
                  ((stable.is(tag)) ||
                  (!stable.is(tag) && !stable.is(library.version))))))
                {
                console.log('Updated package.json to version'.green, tag);
                var libraryPath = path.normalize(
                  path.join(__dirname, '../../cdnjs', 'ajax',
                            'libs', library.name, 'package.json')
                );
                var libraryJSON = JSON.parse(fs.readFileSync(libraryPath, 'utf8'));
                libraryJSON.version = tag;
                fs.writeFileSync(libraryPath, JSON.stringify(libraryJSON, undefined, 2) + '\n');
              }

              async.each(allFiles, function (file, callback) {
                var fileName = file._;
                var fileTarget = path.normalize(
                                    path.join(__dirname, '../../cdnjs', 'ajax',
                                      'libs', library.name, tag, fileName)
                                    );
                fs.ensureFile(fileTarget, function (err) {
                  if (err) {
                    console.log('Some strange error occured here'.red);
                    console.dir(err);
                    callback();
                  } else {
                    rp({
                      uri: 'https://raw.githubusercontent.com/'
                        + githubRepo(library.autoupdate.target) + '/'
                        + path.normalize(path.join(file.tree, file.basePath, fileName)),
                      headers: {
                        'User-Agent': userAgent
                      }
                    })
                    .then(function (fileData) {
                      fs.writeFile(fileTarget, fileData, function (err) {
                        if (err) {
                          console.dir(err);
                          console.log('Some strange error occured here'.red);
                          callback();
                        } else {
                          fs.chmodSync(fileTarget, '0644');
                          callback();
                        }
                      });
                    })
                    .catch(function (err) {
                      console.log('error in file retrieval from GitHub');
                      callback();
                    });
                  }
                });
              },

              function () {
                callback();
              });
            });
          },

          function () {
            console.log(library.name.green, 'updated from GitHub'.green);
            callback(null, 1);
          });
        })
        .catch(function (err) {
          console.log(library.name, 'git tag handle failed');
          console.dir(err);
          next();
        });
      }
  ]);
};

var githubRepo = function (url) {
  return url.slice(url.indexOf('/', 10) + 1, url.indexOf('.git'));
};

module.exports = {
  update: update
};

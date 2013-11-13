var fs = require('fs');
var path = require('path');
var pkgcloud = require('pkgcloud');

var configDefaults = {
  "provider": "rackspace",
  "region": "ORD",
  "container": "images",
  "processes": 10,
  "paths": [],
  "mask": "./"
};

var config = require('./config.json');
for (var key in configDefaults) {
  if (!config.hasOwnProperty(key)) {
    config[key] = configDefaults[key];
  }
}

var pathFilter = new RegExp("^[\\.\\" + path.sep + "]+","g")
var mtimeFilter; // file mod time filter
var uploadCount = 0; // number of files uploaded
var uploadProcs = 0; // number currently uploading
var uploadDelay = false; // flag for delayed upload

var printUsage = function () {
  console.log("Usage: " + process.argv[0] + " " + process.argv[1].replace(/^.*[\\\/]/,'') + " [options] <paths>\n");
  console.log("Options:");
  console.log("   --help      Show usage instructions");
  console.log("   -r <region> Upload files to <region> region");
  console.log("   -c <name>   Upload files to <name> container");
  console.log("   -p <procs>  Allow up to <procs> processes to run concurrently");
  console.log("   -d <days>   Only include files modified within <days> days ago");
  console.log("   -m <mask>   Remove regular expression <mask> from remote file paths");
  process.exit(0);
}

var findFiles = function (basePath, callback) {
  var procs = 0;
  var map = {};

  if (mtimeFilter) {
    console.log('Excluding files older than ' + new Date(mtimeFilter));
  }

  (function read(filePath, callback) {
    procs++;
    console.log('Reading from ' + filePath);
    fs.readdir(filePath, function (err, files) {
      var readCount = 0;
      if (err) console.log(err);
      if (!map[filePath]) map[filePath] = [];

      for (var i = 0, len = files.length; i < len; i++) {
        if (!(/^[^\.][A-Z0-9.-_]+$/i.test(files[i]))) continue;

        var subPath = filePath + path.sep + files[i];
        try {
          var stat = fs.statSync(subPath);
          if (stat.isDirectory()) {
            map[subPath] = [];
            read(subPath, callback);
          } else if (stat.isFile()) {
            if (!mtimeFilter || stat.mtime.getTime() > mtimeFilter) {
              map[filePath].push(files[i]);
              readCount++;
            }
          }
        } catch (err) {
          console.error(err);
        }
      }

      procs--;
      if (callback && !procs) {
        console.log('Found ' + readCount + ' file' + (readCount === 1 ? '' : 's') + '.');
        callback(undefined, map);
      }
    });
  })(basePath, callback);
};

var createContainer = function (map, callback) {
  client.getContainers(function (err, containers) {
    if (err) return callback(err);

    var containerNames = [];
    if (containers && containers.length) {
      for (var i = 0, len = containers.length; i < len; i++) {
        containerNames.push(containers[i].name);
      }
    }

    if (containerNames.indexOf(config.container) === -1) {
      client.createContainer({ name: config.container }, function (err, container) {
        if (err) return callback(err);
        if (container) {
          console.log('Created container: ' + config.container);
          console.log(container);
          return callback();
        } else return callback('Unable to create container: ' + config.container);
      });
    } else return callback();
  });
};

// side < 0 = left, side > 0 = right, else center
var stringPad = function (str, len, side, pad) {
  var center = !side;
  if (center) side = -1;
  if (!pad) pad = ' ';

  while (str.length < len) {
    if (center && side < 0) side = 1;
    else if (center) side = -1;
    str = (side < 0) ? pad + str : str + pad;
  }
  return str;
};

var uploadFiles = function (map, callback) {
  var done = function (err) {
    if (uploadProcs || uploadDelay) return setTimeout(done.bind(this, err), 1000); // uploading 
    console.log(uploadCount + ' file' + (uploadCount === 1 ? '' : 's') +
      ' uploaded to container "' + config.container + '"');
    return callback ? callback(err) : undefined;
  };

  var uploadFile = function (localPath, callback) {
    var remotePath = localPath.replace(pathFilter, '')
      .replace(config.mask, '') // apply path mask
      .replace(pathFilter, '') // again after mask
      .replace(/\\/g, '/') // replace back slashes
      .replace(/\s/g, '_'); // replace white space
    var startTime = new Date().getTime();
    console.log('Uploading file: ' + localPath);
    try {
      client.upload({
        local: localPath,
        remote: remotePath,
        region: config.region,
        container: config.container
      }, function (err, result) {
        var endTime = new Date().getTime();
        uploadDelay = false;
        if (!err && result) uploadCount++;
        console.log("  " + stringPad(remotePath.slice(-60), 64, 1) + 
          (result ? "OK (" + ((endTime - startTime) / 1000).toFixed(3) + " sec)" : "FAILED"));
        return callback(err);
      });
    } catch (err) {
      callback(err);
    }
  };

  if (Object.keys(map).length > 0) for (var localPath in map) {
    if (typeof map[localPath] != 'object' || !Object.keys(map[localPath]).length) {
      delete map[localPath];
      continue;
    }

    while (Object.keys(map[localPath]).length && uploadProcs < config.processes) {
      ++uploadProcs;
      uploadFile(localPath + path.sep + map[localPath].shift(), function (err) {
        --uploadProcs;
        if (err) console.error(err);
        if (!uploadProcs) done();
      });
    }

    if (Object.keys(map[localPath]).length) { // more files in path
      uploadDelay = true;
      return setTimeout(uploadFiles.bind(this, map, callback), 1000);
    } else delete map[localPath];

    if (!Object.keys(map).length) return done(); // input done
  } else if (!uploadProcs && !uploadDelay) return done(); // input empty
};


// begin the program execution

try {
  var client = pkgcloud.storage.createClient(config);

  // read command line arguments
  if (process.argv.length > 2) {
    for (var i = 2; i < process.argv.length; i++) {
      if (process.argv[i] == '--help') {
        printUsage();
        process.exit(0);
      } else if (process.argv[i] == '-r') {
        config.region = process.argv[++i];
        if (!config.region || !/^[A-Z]{3}$/.test(config.region)) {
          throw 'Invalid region specified: ' + process.argv[i];
        }
      } else if (process.argv[i] == '-c') {
        config.container = process.argv[++i];
        if (!config.container || !/^[a-z0-9-_]+$/.test(config.container)) {
          throw 'Invalid container name specified: ' + process.argv[i];
        }
      } else if (process.argv[i] == '-p') {
        config.processes = parseInt(process.argv[++i], 10);
        if (isNaN(config.processes) || !config.processes || config.processes < 1) {
          throw 'Invalid process limit specified: ' + process.argv[i];
        }
      } else if (process.argv[i] == '-d') {
        var days = parseFloat(process.argv[++i]);
        if (days && !isNaN(days)) {
          mtimeFilter = new Date().getTime() - (days * 24 * 60 * 60 * 1000);
        } else throw 'Invalid number of days specified: ' + process.argv[i];
      } else if (process.argv[i] == '-m') {
        config.mask = new RegExp(path.normalize(process.argv[++i].replace(pathFilter,'')));
        if (!config.mask) throw 'Invalid remote mask specified: ' + process.argv[i];
      } else {
        config.paths.push(path.normalize(process.argv[i]));
      }
    }
  }

  if (!config.paths || !config.paths.length) throw printUsage();
  else config.paths.forEach(function (basePath, i) {
    if (!basePath) return;
    findFiles(basePath, function (err, map) {
      if (err) throw err;
      createContainer(map, function (err) {
        if (err) throw err;
        console.log('Uploading to container "' + config.container + '" in "' + config.region + '" region...');
        uploadFiles(map, function (err) {
          if (err) throw err;
          console.log('Uploading finished ' + new Date());
        });
      });
    });
  });
} catch (err) {
  console.error(err);
  process.exit(1);
}

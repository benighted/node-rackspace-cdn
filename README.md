Rackspace Cloud Files API Interface
===================================
Dependencies
------------
[pkgcloud](https://github.com/nodejitsu/pkgcloud) [[npm]](https://npmjs.org/package/pkgcloud)

Installation
------------
    $ git clone https://github.com/trollandtoad/node-rackspace-cdn.git
    $ cd node-rackspace-cdn
    $ cp config.sample.json config.json
    $ npm install pkgcloud

Usage
-----
    $ node cdn [options] <paths>

Options
-------
    --help      Show usage instructions
    -r <region> Upload files to <region> region
    -c <name>   Upload files to <name> container
    -p <procs>  Allow up to <procs> processes to run concurrently
    -d <days>   Only include files modified within <days> days ago
    -m <mask>   Remove regular expression <mask> from remote file paths

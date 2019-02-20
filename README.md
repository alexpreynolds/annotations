# annotations

This project is an Expressjs and Redis-backed annotations web service with autocomplete functionality. 

A React component will be included for demonstration of use of the backend service with a frontend application.

Annotations can be added, removed, and queried via standard web request idioms. A web-based management frontend will be included at a later time.

- [Setup](#setup)
  1. [Ubuntu](#ubuntu)
  2. [Nodejs](#nodejs)
  3. [Redis](#redis)
  4. [PM2](#pm2)
  
- [Requests](#requests)
  1. [Set](#set)
  2. [Sets](#sets)

## Setup

### Ubuntu

Install dependencies:

```
sudo dpkg --clear-selections
sudo install dselect
sudo dselect update
sudo dpkg --set-selections < ubuntu_package_list.txt
sudo dselect update
sudo apt-get dselect-upgrade -y
sudo shutdown -r now
```

### Nodejs

```
cd ~
wget -qO- https://nodejs.org/dist/v11.10.0/node-v11.10.0-linux-x64.tar.xz > node-v11.10.0-linux-x64.tar.xz
tar xvf node-v11.10.0-linux-x64.tar.xz
cd node-v11.10.0-linux-x64/bin
sudo mv /usr/bin/node /usr/bin/node.backup
sudo ln -s ${PWD}/node /usr/bin/node
sudo ln -s ${PWD}/npm /usr/bin/npm
sudo ln -s ${PWD}/npx /usr/bin/npx
```

### Redis

#### Installation

```
cd ~
sudo apt-get install -y tk8.5
wget http://download.redis.io/redis-stable.tar.gz
tar xvzf redis-stable.tar.gz
rm redis-stable.tar.gz
cd redis-stable
make
make test
sudo make install
```

#### Kernel configuration

Edit `sysctl.conf`:

```
sudo emacs /etc/sysctl.conf
```

Add:

```
vm.overcommit_memory = 1
```

Edit `rc.local`:

```
$ sudo emacs /etc/rc.local
```

Add:

```
echo never > /sys/kernel/mm/transparent_hugepage/enabled
```


Reboot:

```
$ sudo shutdown -r now
```

#### Service configuration


Configure `~/redis-stable/redis.conf` and add key-value pairs:

```
maxmemory 8gb
maxmemory-policy allkeys-lru
```

Start server:

```
$ redis-server
```

To test from another host:

```
$ redis-cli ping
PONG
```

#### Service boot-time startup

```
sudo mkdir /etc/redis
sudo cp ~/redis-stable/redis.conf /etc/redis/6379.conf
sudo mkdir -p /var/redis/6379
```

Edit configuration file:

```
$ sudo emacs /etc/redis/6379.conf
```

Add key-value pairs:

```
daemonize yes
pidfile /var/run/redis_6379.pid
logfile /var/log/redis_6379.log
dir /var/redis/6379
```

Edit startup script:

```
sudo cp ~/redis-stable/utils/redis_init_script /etc/init.d/redis_6379
sudo emacs /etc/init.d/redis_6379
```

Add required keys in `BEGIN INIT INFO` block:

```
# Required-Start:       $syslog
# Required-Stop:        $syslog
# Should-Start:         $local_fs
# Should-Stop:          $local_fs
```

Update defaults:

```
$ sudo update-rc.d redis_6379 defaults
```

Test startup of redis instance:

```
$ sudo /etc/init.d/redis_6379 start
```

Test call-response:

```
$ redis-cli
127.0.0.1:6379> ping
PONG
```

Reboot:

```
$ sudo shutdown -r now
```

Test call-response on restart:

```
$ redis-cli
127.0.0.1:6379> ping
PONG
```

### nginx

The `nginx` web server is used to proxy requests to the Expressjs backend (which in turn queries the Redis database). 

We must add configuration files to route requests sent to the development and production servers.

Edit `/etc/nginx/sites-available/annotations-development` and add the following:

```
server {
  listen 3000;
  server_name annotations.altius.org;
  
  access_log /var/log/nginx/annotations-development.access.log;
  error_log /var/log/nginx/annotations-development.error.log;
  location / {
    proxy_pass http://internal:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
```

Edit the `server_name` and `proxy_pass` parameters for local installation.

Create `/etc/nginx/sites-available/annotations-production` and add the following:

```
server {
  listen 80;
  server_name annotations.altius.org;
  root /var/www/annotations;
  index index.html;
  
  access_log /var/log/nginx/annotations-production.access.log;
  error_log /var/log/nginx/annotations-production.error.log;
  location / {
    try_files $uri /index.html =404;
  }
}
```

Edit the `server_name` property for local installation.

Create `/etc/nginx/sites-available/annotations-server` and add the following:

```
server {
  listen 8000;
  server_name annotations.altius.org;
  
  access_log /var/log/nginx/annotations-development.access.log;
  error_log /var/log/nginx/annotations-development.error.log;
  location / {
    proxy_pass http://internal:8081;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    client_max_body_size 128M;
  }
}
```

Edit the `server_name`, `proxy_pass`, and `client_max_body_size` parameters for local installation.

Link these to the `sites-enabled` directory:

```
sudo ln -s /etc/nginx/sites-available/annotations-development /etc/nginx/sites-enabled/annotations-development
sudo ln -s /etc/nginx/sites-available/annotations-production /etc/nginx/sites-enabled/annotations-production
sudo ln -s /etc/nginx/sites-available/annotations-server /etc/nginx/sites-enabled/annotations-server
```

Restart the `nginx` service:

```
sudo service nginx restart
```

Check that `nginx` is up and running (correcting whatever issues may be reported, if any, and restarting the service):

```
sudo service nginx status
```

### PM2

```
cd ~
npm install pm2@latest -g
sudo ln -s ${PWD}/node-v11.10.0-linux-x64/bin/pm2 /usr/bin/pm2
sudo ln -s ${PWD}/node-v11.10.0-linux-x64/bin/pm2-dev /usr/bin/pm2-dev
sudo ln -s ${PWD}/node-v11.10.0-linux-x64/bin/pm2-docker /usr/bin/pm2-docker
sudo ln -s ${PWD}/node-v11.10.0-linux-x64/bin/pm2-runtime /usr/bin/pm2-runtime
npm install nodemon -g
sudo ln -s ${PWD}/node-v11.10.0-linux-x64/bin/nodemon /usr/bin/nodemon
```

To start `pm2` with annotation service parameters, edit `annotations-server.development.json` (or `annotations-server.production.json`) with host and other settings changes.

Then initialize `pm2` with this script (either `development` or `production`):

```
cd annotations
npm install --save
pm2 start annotations-server.development.json
```

To have `pm2` start on boot with the current tasks running:

```
sudo pm2 startup
```

A test request for a list of annotation sets (detailed [below](#sets)) should return an empty object ("empty set") and a 404 error code, *e.g.*:

```
$ curl -v "http://localhost:8000/sets"
*   Trying 127.0.0.1...
* TCP_NODELAY set
* Connected to localhost (127.0.0.1) port 8000 (#0)
> GET /sets HTTP/1.1
> Host: localhost:8000
> User-Agent: curl/7.58.0
> Accept: */*
> 
< HTTP/1.1 404 Not Found
< Server: nginx/1.14.0 (Ubuntu)
< Date: Fri, 15 Feb 2019 23:50:19 GMT
< Content-Type: application/json; charset=utf-8
< Content-Length: 2
< Connection: keep-alive
< X-Powered-By: Express
< Vary: Origin
< ETag: W/"2-vyGp6PvFo4RvsFtPoIWeCReyIC8"
< 
* Connection #0 to host localhost left intact
{}
```

## Requests

Web requests to the annotations service are the means by which annotations are added, deleted, and queried.

For purposes of this application, we define a group of annotations as a "set". Examples of such groups might be GENCODE or dbSNP annotations of a particular version. Multiple groups are called "sets". 

Requests are performed on a `set` or on `sets`.

### Set

#### List set properties

Given a set with the unique identifier `280dd7d0-2771-413a-9840-a16a25330072`, its metadata can be retrieved via a `GET` method request, *e.g.*:

```
curl "http://localhost:8000/set?id=280dd7d0-2771-413a-9840-a16a25330072"
```

If the given identifier does not refer back to an existing set, a 404 error is returned.

#### Delete

Given a set with the unique identifier `280dd7d0-2771-413a-9840-a16a25330072`, its annotations and metadata can be deleted via the `DELETE` method, *e.g.*:

```
curl -X "DELETE" "http://localhost:8000/set?id=280dd7d0-2771-413a-9840-a16a25330072"
```

#### Add

A new set can be uploaded via the `POST` method, with specified form properties:

```
curl -F 'annotationFile=@/path/to/myAnnotations.bed' \
     -F 'annotationDescription="myAnnotations"' \
     -F 'annotationVersion=1' \
     -F 'annotationAssembly="hg38"' \
     -F 'annotationTimestamp=1548189087529' \
     "http://localhost:8000/set"
```

The file being uploaded should be a minimally BED4 file, where the fourth column is the annotation name. The annotation service will store fields up to the twelfth column (*i.e.*, a BED12 file).

A full description of form properties will be provided in a future revision of this document.

### Sets

#### Get a listing of all sets

A `GET` request on `sets` returns a list of metadata identifiers for all sets, *i.e.*:

```
curl "http://localhost:8000/sets"
```

If there are no sets in the database, this request returns an empty object (empty set, or `{}`) and a 404 error.

One can use `assembly` (and other search properties, defined in a future revision) to filter sets by their association with given properties. For instance, to get all `hg38` sets:

```
curl "http://localhost:8000/sets&assembly=hg38"
```

To get further information on the set associated with a metadata identifier, it can be used with a [`set` request](#set).

#### Get annotations for given prefix

All sets of specified `assembly` (and other search properties) can be queried for the given annotation prefix, using a `GET` request with query parameters which include `q=<prefix>`, *e.g.*:

```
curl "http://localhost:8000/sets?q=HOXA&assembly=hg38"
```

This example request returns any annotation records which start with the prefix `HOXA`, if available, from all sets that are associated with the `hg38` assembly.

# annotations

This project is an Expressjs and Redis-backed annotations web service with autocomplete functionality. A React component will be included for demonstration of use of the backend service with a frontend application.

* [Setup](#setup)
** [Ubuntu](#ubuntu)
** [Nodejs](#nodejs)
** [Redis](#redis)
** [PM2](#pm2)

## Setup {#setup}

### Ubuntu {#ubuntu}

```
dpkg --clear-selections
sudo dpkg --set-selections < ubuntu_package_list.txt
```

### Nodejs {#nodejs}

```
cd ~
wget -qO- https://nodejs.org/dist/v11.10.0/node-v11.10.0-linux-x64.tar.xz > node-v11.10.0-linux-x64.tar.xz
tar xvf node-v11.10.0-linux-x64.tar.xz
cd node-v11.10.0-linux-x64/bin
sudo ln -s ${PWD}/node /usr/bin/node
sudo ln -s ${PWD}/npm /usr/bin/npm
sudo ln -s ${PWD}/npx /usr/bin/npx
```

### Redis {#redis}

#### Installation

```
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

````
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

### PM2 {#pm2}

```
npm install pm2@latest -g
```

To start `pm2` with annotation service parameters, edit `annotations-server.development.json` (or `annotations-server.production.json`) with host and other settings changes. Then boot `pm2` with this script (either `development` or `production`):

```
pm2 start annotations-server.development.json
```

To have `pm2` start on boot with the current tasks running:

```
pm2 startup
```
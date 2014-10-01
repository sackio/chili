#!/bin/bash

### BEGIN INIT INFO
# Provides:             pbsite
# Required-Start:       $syslog $remote_fs
# Required-Stop:        $syslog $remote_fs
# Should-Start:         $local_fs
# Should-Stop:          $local_fs
# Default-Start:        2 3 4 5
# Default-Stop:         0 1 6
# Short-Description:    pbsite
# Description:          pbsite init.d script
### END INIT INFO

### BEGIN CHKCONFIG INFO
# chkconfig: 2345 55 25
# description: chili
### END CHKCONFIG INFO

#node settings
NODE_BIN_DIR="/usr/local/bin"
NODE_PATH="/usr/local/lib/node_modules"

#application settings
NAME="Chili"
APP_USER="root"
APPLICATION_PATH=""
APPLICATION_SCRIPT="lib/chili.js"

#git settings
GIT_BRANCH="master"
GIT_REMOTE="origin"
GIT_MERGE_AUTOEDIT="no"

#forever settings
PIDFILE="/var/run/pids/chili.pid"
LOG="/var/logs/chili.log"
MIN_UPTIME="5000"
SPIN_SLEEP_TIME="2000"

#custom settings
PORT=8000

# Add node to the path for situations in which the environment is passed.
PATH=$NODE_BIN_DIR:$PATH
# Export all environment variables that must be visible for the Node.js
# application process forked by Forever. It will not see any of the other
# variables defined in this script.
export NODE_PATH=$NODE_PATH

start() {
    echo "Starting $NAME"

    #git update
    cd "$APPLICATION_PATH"
    sudo -u $APP_USER git stash
    sudo -u $APP_USER git checkout "$GIT_BRANCH"
    sudo -u $APP_USER git pull -f "$GIT_REMOTE" "$GIT_BRANCH"
    sudo -u $APP_USER git submodule init
    sudo -u $APP_USER git submodule update

    #npm update
    cd "$APPLICATION_PATH"
    sudo npm install

    #forever script
    sudo -u $APP_USER forever \
      --pidFile $PIDFILE \
      -a \
      -l $LOG \
      --minUptime $MIN_UPTIME \
      --spinSleepTime $SPIN_SLEEP_TIME \
      start "$APPLICATION_PATH/$APPLICATION_SCRIPT" 2>&1 > /dev/null &
    RETVAL=$?
}
 
stop() {
    if [ -f $PIDFILE ]; then
        echo "Shutting down $NAME"
        # Tell Forever to stop the process.
        forever stop "$APPLICATION_PATH/$APPLICATION_SCRIPT" 2>&1 > /dev/null
        # Get rid of the pidfile, since Forever won't do that.
        rm -f $PIDFILE
        RETVAL=$?
    else
        echo "$NAME is not running."
        RETVAL=0
    fi
}
 
restart() {
    stop
    start
}
 
status() {
    echo `forever list` | grep -q "$APPLICATION_PATH/$APPLICATION_SCRIPT"
    if [ "$?" -eq "0" ]; then
        echo "$NAME is running."
        RETVAL=0
    else
        echo "$NAME is not running."
        RETVAL=3
    fi
}
 
case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    status)
        status
        ;;
    restart)
        restart
        ;;
    *)
        echo "Usage: {start|stop|status|restart}"
        exit 1
        ;;
esac
exit $RETVAL

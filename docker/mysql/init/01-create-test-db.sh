#!/bin/sh
# Runs once, when the MySQL data volume is first initialised.
# Creates the integration-test database next to the main one and grants the app user access.
#
# The official entrypoint either sources or executes this file depending on its mode bits
# (bind mounts from Windows look executable), so it only relies on the container environment.

MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?}" mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE:?}_test\`;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO '${MYSQL_USER:?}'@'%';
SQL

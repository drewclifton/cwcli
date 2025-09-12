import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';

export async function ensureDockerFiles(siteDir, { siteSlug, dbName, wpPort }) {
  const composePath = path.join(siteDir, 'docker-compose.yml');
  const envPath = path.join(siteDir, '.env');

  const compose = {
    services: {
      db: {
        image: 'mariadb:10.6',
        environment: {
          MYSQL_ROOT_PASSWORD: 'root',
          MYSQL_DATABASE: dbName,
          MYSQL_USER: 'wp',
          MYSQL_PASSWORD: 'wp',
        },
        volumes: ['db_data:/var/lib/mysql'],
        ports: ['0:3306'],
      },
      php: {
        image: 'wordpress:php8.2-fpm',
        depends_on: ['db'],
        volumes: ['./wp:/var/www/html']
      },
      wpcli: {
        image: 'wordpress:cli-php8.2',
        depends_on: ['db'],
        environment: {
          WORDPRESS_DB_HOST: 'db',
          WORDPRESS_DB_USER: 'wp',
          WORDPRESS_DB_PASSWORD: 'wp',
          WORDPRESS_DB_NAME: dbName,
        },
        user: 'root',
        volumes: ['./wp:/var/www/html']
      },
      nginx: {
        image: 'nginx:1.25-alpine',
        depends_on: ['php'],
        ports: [`${wpPort}:80`],
        volumes: [
          './wp:/var/www/html',
          './.cw/nginx.conf:/etc/nginx/conf.d/default.conf'
        ]
      }
    },
    volumes: {
      db_data: {}
    }
  };

  await fs.ensureDir(path.join(siteDir, '.cw'));
  const nginxConf = `server {\n  listen 80;\n  server_name ${siteSlug}.test;\n  root /var/www/html;\n\n  index index.php index.html index.htm;\n\n  location / {\n    try_files $uri $uri/ /index.php?$args;\n  }\n\n  location ~ \\.php$ {\n    include fastcgi_params;\n    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n    fastcgi_pass php:9000;\n  }\n}`;

  await fs.writeFile(path.join(siteDir, '.cw/nginx.conf'), nginxConf);
  await fs.writeFile(composePath, yaml.stringify(compose));
  await fs.writeFile(envPath, `WP_PORT=${wpPort}\nSITE_SLUG=${siteSlug}\nDB_NAME=${dbName}\n`);
}

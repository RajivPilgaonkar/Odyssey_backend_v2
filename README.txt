========= FRESH INSTALL ON DEV ================
1. Let's say the directory where you want to install is 'backend'
2. cd backend
3. git clone https://rajiv_p@bitbucket.org/rajiv_p/vivaphysics-node-backend.git
4. npm install
5. node app.js

========= SIMULATE THE PRODUCTION ENVIRONMENT (but being on the devlopment server for debugging) ====
1. Instead of 'node app.js', run 'npm run build:dev' (this will read the .env.production file from config)

========= FRESH INSTALL ON PRODUCTION ================
1. Use winSSH to connect to Digital Ocean
2. cd /var/www/html/projects/vivaphysics
3. Let's say the directory where you want to install is 'backend'
4. cd backend
5. git clone https://github.com/vivaphysics/vivaphysics-node-backend.git . (use the dot at the end to install in current dir)
6. npm install 
7. ps -aux | grep node (this will list all the processes with node) or try "lsof -i :5000" to list processes using the port 5000
8. sudo kill <pid> (use this to kill the process as described in the package.json file)
9. ps -aux | grep node (to ensure node process has been killed)
10. npm run build:prod
11. ps -aux | grep node (to ensure node process has been started again)
12. www.vivaphysics.net/db/getParts (type this in the browser and check if you get some data)
13. ^C

====== UPDATE ON DEV ====
1. cd backend
2. node app.js

====== UPDATE ON PRODUCTION ====
1. cd /var/www/html/projects/vivaphysics
2. cd backend
3. git clone https://github.com/vivaphysics/vivaphysics-node-backend.git
4. npm install (if new packages were installed since the last update) 
5. ps -aux | grep node (this will list all the processes with node) or try "lsof -i :5000" to list processes using the port 5000
6. sudo kill <pid> (use this to kill the process as described in the package.json file)
7. ps -aux | grep node (to ensure node process has been killed)
8. npm run build:prod
9. ps -aux | grep node (to ensure node process has been started again)
10. www.vivaphysics.net/db/getParts (type this in the browser and check if you get some data)
11. ^C


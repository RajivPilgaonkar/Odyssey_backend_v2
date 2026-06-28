## Install on Development Machine

Let's say you want to install the project in an empty directory **'E:\node_projects\odyssey\backend\v1':**
1. Using a nodeJS command prompt, **run as Administrator**
2. Go to the directory **'E:\node_projects\odyssey\backend\v1'**
3. run **`git clone https://github.com/RajivPilgaonkar/Odyssey_backend.git .`** Don't forget to include the '.' after 'backend.git'.
4. run **`npm install`** (This will install the packages and compile the program)
5. run **node app.js**
6. You may have to copy .env files from the config folder, in case they were not included in the git

## Debugging

1. To test on the local machine, `GET`, `localhost:5100/db/getCities`
2. Or type in the same into postman. Or try it with `http://` appended before `localhost`.
3. Check if you can connect to the database through node, `GET`, `localhost:5100/db/connect`. You should see a message `Connected to database`
4. If you cannot even connect to the db, try a simple route `GET`, `localhost:5100/db/getTest`.


## Tests in Postman

1. Get Record -- `POST`, `localhost:5100/db/getRecord`
**Header** Key: Content-type Value: application/json
**Body**
    {
      "fields": ["*"],
      "orders": [ "bookings_id" ],
      "table": "bookings",
      "where": "booked >= '01/15/2020'"
    }

2. Update Record -- `POST`, `localhost:5100/db/updateRecord`
**Header** Key: Content-type Value: application/json
**Body**
    {
      "data": {"citycode": "AAB"},
      "keyField": "cities_id",
      "keyValue": 735,
      "table": "cities"
    }

3. Insert Record -- `POST`, `localhost:5100/db/insertRecord`
**Header** Key: Content-type Value: application/json
**Body**
    {
	      "columns": ["cities_id", "city", "cityAlias", "useAlias"],
	      "table": "cities",
	      "values": [736, "New ZZZ", "ZZZ Alias", 0]
    }

4. Delete Record -- `POST`, `localhost:5100/db/deleteRecord`
**Header** Key: Content-type Value: application/json
**Body**
    {
      "keyField": "cities_id",
      "keyValue": 736,
      "table": "cities"
    }

5. Stored Procedure -- `POST`, `localhost:5100/db/executeSP`
**Header** Key: Content-type Value: application/json
**Body**
    {
      "sql": "EXEC [p_HotelList] 2, 3 "
    }

6. Does Exist -- `POST`, `localhost:5100/db/doesExist`
**Header** Key: Content-type Value: application/json
**Body**
    {
      "table": "cities",
      "condition": "WHERE cities_id = 735"
    }


localhost:5200/db/doesExist

## Recompile everything afresh in command prompt

1. del /F/Q/S node_modules > nul
2. rmdir /Q /S node_modules
3. npm install
4. node app.js

## If SQL Queries / Procedures are slow or erratic

1. In the **dbRoutes.js**, check pool and dialect options
2. In the **dbRoutes.js**, set **debugging** to true so all SQL statements get printed in console window where you initiate `node app.js`


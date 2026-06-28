/*========================================================*/
/*=== setup all authorization routes =====================*/
/*========================================================*/
const jwt = require('jsonwebtoken');

module.exports = (app) => {

  //*************************************************************
  app.post('/auth/generateToken', async (req, res) => {

    const userName = req.body.userName;
    const user = {name: userName};
    const secretKey = process.env.JWT_ACCESS_TOKEN_SECRET;
    let expiryDays = req.body.expiryDays;
    if (expiryDays === undefined || expiryDays === null || expiryDays < 1) {
      expiryDays = 1;
    }
    // Reduce by 8 hours
    const expirySeconds = expiryDays*24*60*60 - 8*60*60; 

    const options = {
      expiresIn: expirySeconds, // You can specify the expiry time in seconds or a string with a time unit (e.g., '1h' for 1 hour)
    };

    const accessToken = jwt.sign(user, secretKey, options);
    return res.json({accessToken: accessToken});
    
  });
  

  //*************************************************************
  app.post('/auth/verifyToken', async (req, res) => {

    const authHeader = req.headers.authorization;
    const token = authHeader.split(' ')[1];

    const secretKey = process.env.JWT_ACCESS_TOKEN_SECRET;

    if (!token) {
      return res.status(400).json({ message: 'No token provided' });
    }    

    jwt.verify(token, secretKey, (err, decoded) => {
      if (err) {
        return res.status(400).json({ message: 'Token is invalid' });
      }
      // Token is valid, store the decoded information (e.g., user details) for use in your route handlers.
      return res.send({success: 1, decoded: decoded});
    });
        
  });

};


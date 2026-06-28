## Debugging Email Issues

1. **`Setup on Debugging Machine`**
* If you get an unauthorized message (in the DOS node screen backend), it is likely that the refresh token has expired. Check in 
'Gmail Node API setting' documentation on how to refresh the token.
* Ensure that you are logged into chrome Gmail using your credentials
* Copy the token and paste it in the mailCredentials.js file
* From the drop down in the top panel, select 'Odyssey Node Gmail' as the active project
* Go to the .env file, and set GMAIL_SEND_TO_RECIPIENT = 0. This will send the mail out only to you and ignore the other recipients.
* In the Node DOS screen, CTRL-C to terminate current session
* `node app.js` to start new session

2. **`Database Modifications`**
* update admusers set Email = 'rpilgaonkar@gmail.com' where AdmUsers_id = 8 and uid = 'sa'

3. **`Mail & Check`**
* Send mail from the front end
* Check Gmail Drafts folder to check if mail has been created and sent

4. **`Troubleshooting`**
* If the mail is not sent, then check the following:
* Make sure you have a browser screen open with your own gmail login. Ex (xxx@odyssey.co.in)
* In BackOffice, your login should correspond to you email in the previous step
* Send the mail
* If the mail is sent but the recipients are incorrect (going to self), then check the .env file in backend/dev/config directory. 
* If GMAIL_SEND_TO_RECIPIENT=0, it would go to self, set it as 1 or it to go to the actual recipients.
* On Odyssey Server, change in both `.env` and `.env.production`
* If you still have problems sending the mails, go to the mailRoutes.js file and uncomment the line `//const recipient = req.body.recipient;`




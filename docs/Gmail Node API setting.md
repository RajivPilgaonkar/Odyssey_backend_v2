## Gmail Node API setting for sending emails with attachments through node

1. **`Go to console.developers.google`** or **`https://console.cloud.google.com/apis/`**
* Using the drop down in the top panel, create a new project
* Let's say this project is named 'Odyssey Node Gmail' and click on 'Create'
* From the drop down in the top panel, select 'Odyssey Node Gmail' as the active project

2. **`OAuth Consent Screen`**
* From the vertical menu on the left, click on 'OAuth Consent Screen'
* Click on 'External' in the radio box, and click 'Create'
* Add Test User : rpilgaonkar@gmail.com
* App Name: 'BackOffice Web'
* User Support Email: 'admin@odyssey.co.in'
* Developer Contact Info: 'admin@odyssey.co.in', and click 'Save & Continue'
* click 'Save & Continue'

3. **`Credentials`**
* From the vertical menu on the left, click on 'Credentials'
* Click on '+ Create Credentials'
* Click on 'OAuth Client ID'
* Application Type: 'web application', 
* Authorised redirect URIs: https://developers.google.com/oauthplayground
* Click on 'Create' at the bottom
* This will display your project's 'Client ID' and 'Client Secret'
* Download the JSOn file
* Save 'Client ID' and 'Client Secret' to a notepad file

4. **`Get Token`**
* Go to https://developers.google.com/oauthplayground
* Click on 'GMail API' in the list box
* Click on 'https://mail.google.com/'
* On the top right, click on the Settings (Gears icon)
* Tick on 'Use your own OAuth credentials'
* Copy & paste the 'Client ID' and 'Client Secret' from the notepad file
* Below the list box, click on 'Authorize APIs'
* Choose gmail account
* You may get a message 'Google has not verified this app'. Click on continue.
* 'BackOffice Web wants access to your Google Account' -- Click on continue
* Click on 'Exchange Authorization for Tokens'. This may taken you to 'Step 3'. Click on 'Step 2'
* Copy the refresh token that was generated
* Now the 'Client ID', 'Client Secret', 'Refresh Token' are to be copied into the backend config .env and .end.production files

5. **`Refresh Token`**
* This refresh token generated is valid for just 1 hour.
* Within that time run the backend code so that it is invoked

6. **`Enable Gmail API`**
* Back to the google developer console
* From the vertical menu on the left, click on 'Enabled APIs and Services'
* Click on '+ Enable APIs and Services'
* Goto the bottom, click on Gmail API and if it is not enabled, enable it

7. **`Test mail to Gmail Drafts`**
* Send a mail through the route '/mail/sendMail'
* Check if mail appears in the Gmail drafts folder
* If not, check errors on node screen on backend


 
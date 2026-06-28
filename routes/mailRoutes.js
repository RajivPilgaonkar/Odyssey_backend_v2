/*=============================================================*/
/*=== setup all the database call routes =====================*/
/*=== The routes fetch data from the tables ==================*/
/*=== Parts, Categories, Chapters, Lessons, Users ============*/
/*=============================================================*/
const {google} = require('googleapis');
const nodemailer = require("nodemailer");
var fs = require('fs');
const mailCredentials = require('./mailCredentials.js');

module.exports = (app,db) => {

  /*=== route to print voucher reports ===*/  
  app.post('/mail/sendMail', async (req, res) => {

    try {

      senderEmailObj = mailCredentials.getMailCredentials(req.body.senderEmail);      
      
      const oAuth2Client = new google.auth.OAuth2(senderEmailObj.clientID, senderEmailObj.clientSecret, process.env.REDIRECT_URI);    
      oAuth2Client.setCredentials({refresh_token: senderEmailObj.refreshToken});
      const accessToken = await oAuth2Client.getAccessToken();  
      
      const transport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: req.body.senderEmail,
          clientId: senderEmailObj.clientID,
          clientSecret: senderEmailObj.clientSecret,
          accessToken: accessToken.token,
        }
      });

      //let pdfFile = 'vouchers/voucher_FIT582_2170.pdf';
      let pdfFile = 'vouchers/' + req.body.reportName;

      // allow mail to be sent to self for debugging
      const recipient = (parseInt(process.env.GMAIL_SEND_TO_RECIPIENT) === 0) ? req.body.senderEmail : req.body.recipient;
      //const recipient = req.body.recipient;

      const mailOptions = {
        //from: 'rpilgaonkar@gmail.com',
        to: recipient,
        subject: req.body.tourCode + ' - ' + req.body.paxName + ' - ' + (req.body.organisation !== undefined ? req.body.organisation : ''),
        text: req.body.emailBody,
        attachments: (req.body.reportName > '') ? [ {/*filename: 'voucher_FIT582_2170.pdf',*/ path: `${pdfFile}` } ] : null
        //html: req.body.emailBody,
      };

      // check if draft mail. Then send to drafts box 
      const isDraftMail = (req.body.isDraft === undefined || req.body.isDraft) ? true : false;

      // message to be sent directly to hotel / agent (not in drafts folder)
      if (! isDraftMail) {
        const result = await transport.sendMail(mailOptions);
        res.json({success: true});
      // message to be sent to drafts and physically sent after checking
      } else {

        // attachment to be converted for mime email message
        if (req.body.reportName > '') {
          var attach = new Buffer.from(fs.readFileSync(pdfFile)).toString("base64");
        }

        // boundary for mime emial message
        var boundary = 'xxx_mime_boundary_xxx';

        //subject
        var subject = (req.body.subject !== undefined) ? req.body.subject :
          ((req.body.reportName > '') ? '' : 'Cancellation Request: ') + `${req.body.tourCode + ' - ' + req.body.paxName + ' - ' + (req.body.organisation !== undefined ? req.body.organisation : '')}`;

        // email body to be converted for mime email message
        const message = Buffer.from(req.body.emailBody).toString('base64');

        // The mime message format
        // The order is very important
        // The boundaries and the new lines are also very important
        // The main email body and the attachment are sent as a single mime message
        var email_lines_no_attach = [
          "MIME-Version: 1.0\n",
          'Content-Type: multipart/alternate; boundary="' + boundary + '"\n',
          "--" + boundary + "\n",
          "to: ", recipient, "\n",
          "subject: ", subject, "\n\n",
          "--" + boundary + "\n\n",
          "--" + boundary + "\n",
          "Content-Type: text/plain; charset=UTF-8\n",
          "Content-Transfer-Encoding: base64\n",
          message + "\n",
          "--" + boundary + "\n\n"
        ];

        if (req.body.reportName > '') {
          email_lines_no_attach.push("--" + boundary + "\n");
          email_lines_no_attach.push('Content-Type: application/pdf; name="' + req.body.reportName + '"\n');
          email_lines_no_attach.push('Content-Disposition: attachment; filename="' + req.body.reportName + '"\n');
          email_lines_no_attach.push('Content-Transfer-Encoding: base64' + '\n');
          email_lines_no_attach.push(attach);
          email_lines_no_attach.push("--" + boundary + "\n\n");
        }

        let email_lines = email_lines_no_attach.join('');

        // email body to be converted to base64 for the Gmail API
        var email = new Buffer.from(email_lines.trim()).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

        // The authenticated gmail instance
        const gmail = google.gmail({
          version: 'v1',
          auth: oAuth2Client
        });

//console.log('req.body.senderEmail', req.body.senderEmail);

        //const requestBody = {
        //  delegateEmail: 'support@vivaphysics.com',
        //  verificationStatus: 'accepted'
        //}

        //await gmail.users.settings.delegates.create({
        //  userId: 'backoffice-web@odyssey-node-gmail.iam.gserviceaccount.com',
        //  requestBody: requestBody
        //});

        // this gmail api call will place the mail in the gmail drafts folder        
        await gmail.users.drafts.create({
          userId: req.body.senderEmail,
          //userId: "me",
          resource :{
            message: {
              raw: email,
            }
          },
          media:{
            mimeType: "message/rfc822"
          }
        },(err,data,body)=>{
          if (err) {
            console.log('Error sending mail: ', err);
            return res.json({success: false, errorMsg: 'Error sending email'});
          }
        });        

        return res.json({success: true});
          
      }                        
    } catch(e) {
      console.log('*** FAILURE in getting token', e);
      return res.json({success: false, errorMsg: 'Failure in obtaining token OR in Sending email'});
    }

  });

};

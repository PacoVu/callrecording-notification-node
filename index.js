var RC = require('ringcentral')
var fs = require('fs')
require('dotenv').load()
var async = require("async");

var rcsdk = null
if (process.env.MODE == "production"){
  rcsdk = new RC({
    server:RC.server.production,
    appKey: process.env.CLIENT_ID_PROD,
    appSecret:process.env.CLIENT_SECRET_PROD
  })
}else{
  rcsdk = new RC({
      server:RC.server.sandbox,
      appKey: process.env.CLIENT_ID_SB,
      appSecret:process.env.CLIENT_SECRET_SB
    })
}
var platform = rcsdk.platform()
var subscription = rcsdk.createSubscription()
var users = []

login()

function login(){
  var un = ""
  var pwd = ""
  if (process.env.MODE == "production"){
    un= process.env.USERNAME_PROD,
    pwd= process.env.PASSWORD_PROD
  }else{
    un= process.env.USERNAME_SB,
    pwd= process.env.PASSWORD_SB
  }
  platform.login({
    username:un,
    password:pwd
  })
  .then(function(resp){
    removeRegisteredSubscription()
    subscribeForNotification()
  })
  .catch(function(e){
    console.log(e)
    throw e
  })
}

function removeRegisteredSubscription() {
  platform.get('/subscription')
    .then(function (response) {
      var data = response.json();
      if (data.records.length > 0){
        for(var record of data.records) {
          // delete old subscription before creating a new one
          platform.delete('/subscription/' + record.id)
            .then(function (response) {
              console.log("deleted: " + record.id)
            })
            .catch(function(e) {
              console.error(e);
              throw e;
            });
        }
      }
    })
    .catch(function(e) {
      console.error(e);
      throw e;
    });
}

function subscribeForNotification(){
  var eventFilter = ['/restapi/v1.0/account/~/presence']
  subscription.setEventFilters(eventFilter)
  .register()
  .then(function(resp){
    console.log('ready to get account presense')
  })
  .catch(function(e){
    throw e
  })
}

subscription.on(subscription.events.notification, presenceEvent)

function presenceEvent(msg){
  var user = {}
  user['extensionId'] = msg.body.extensionId
  user['telephonyStatus'] = msg.body.telephonyStatus
  user['startTime'] = ""
  checkTelephonyStatusChange(user)
}

function checkTelephonyStatusChange(user){
  var newUser = true
  for (var i=0; i<users.length; i++){
    if (users[i].extensionId == user.extensionId){
      console.log("OLD -> NEW: " + users[i].telephonyStatus + " -> " + user.telephonyStatus)
      newUser = false
      if (users[i].telephonyStatus == "NoCall" && user.telephonyStatus == "Ringing"){
        users[i].telephonyStatus = user.telephonyStatus
        users[i].startTime = createStartTime()
        console.log("START TIME: " + users[i].startTime)
        console.log("ExtensionId " + users[i].extensionId + " has an incoming call")
        break
      }
      if (users[i].telephonyStatus == "Ringing" && user.telephonyStatus == "CallConnected"){
        users[i].telephonyStatus = user.telephonyStatus
        console.log("ExtensionId " + users[i].extensionId + " has a accepted a call")
        break
      }
      if (users[i].telephonyStatus == "Ringing" && user.telephonyStatus == "NoCall"){
        users[i].telephonyStatus = user.telephonyStatus
        console.log("ExtensionId " + users[i].extensionId + " has a missed call")
        break
      }
      if (users[i].telephonyStatus == "CallConnected" && user.telephonyStatus == "NoCall"){
        users[i].telephonyStatus = user.telephonyStatus
        console.log("ExtensionId " + users[i].extensionId + " has a terminated call")
        // wait for 20 secs then check for call recordings
        setTimeout(function(){
          readExtensionCallLogs(users[i].extensionId, users[i].startTime)
        }, 20000)
        break
      }
    }
  }
  if (newUser){
    console.log("NEW USER: " + " -> " + user.telephonyStatus)
    if (user.telephonyStatus == "Ringing"){
      user.startTime = createStartTime()
      console.log("START TIME: " + user.startTime)
      console.log("ExtensionId " + user.extensionId + " has an incoming call")
    }
    users.push(user)
  }
}

function createStartTime(){
  var date = new Date()
  var time = date.getTime()
  // make 10 secs to offset some delay in response
  var lessXXSeconds = time - 10000
  var from = new Date(lessXXSeconds)
  var dateFrom = from.toISOString()
  return dateFrom.replace('/', ':')
}

function readExtensionCallLogs(extensionId, startTime){
  var endpoint = '/account/~/extension/'+ extensionId +'/call-log'
  var params = {}
  var date = new Date()
  var dateTo = date.toISOString()
  dateTo = dateTo.replace('/', ':')
  params['dateFrom'] = startTime
  params['dateTo'] = dateTo
  params['recordingType'] = 'All'

  platform.get(endpoint, params)
  .then(function(resp){
    console.log(resp.json())
    async.each(resp.json().records,
      function(record, callback){
        console.log("THIS CALL HAS A RECORDING: " + record.recording.contentUri)
        saveAudioFile(record)
      },
      function(err){
        console.log("No call with call recording.")
      }
    );
  })
  .catch(function(e){
    var err = e.toString();
    console.log(err)
  })
}


function saveAudioFile(record){
  console.log("saveAudioFile")
  platform.get(record.recording.contentUri)
  .then(function(res) {
    return res.response().buffer();
  })
  .then(function(buffer) {
    var destFile = './recordings/' + record.recording.id + '.mp3'
    fs.writeFileSync(destFile, buffer);
    console.log("CALL RECORDING SAVED AT: " + destFile)
  })
  .catch(function(e){
    console.log(e)
  })
}

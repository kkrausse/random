// Dedicated guest demo profile; no credential discovery or credential copying.
const fs = require('fs');
const file = '/home/user/vivari-v2/config/opencode/opencode.json';
if (fs.existsSync(file)) throw Error('V2 demo configuration already exists; inspect before changing it');
fs.mkdirSync(require('path').dirname(file), {recursive:true});
fs.writeFileSync(file, JSON.stringify({
  $schema:'https://opencode.ai/config.json',
  model:'opencode/nemotron-3.5-lightning-free',
  snapshots:false,
  providers:{opencode:{settings:{baseURL:'http://host.vivari.internal:5206/api/model/opencode'}}},
  permissions:[
    {action:'read',resource:'*',effect:'allow'},
    {action:'edit',resource:'*',effect:'allow'},
  ],
},null,2)+'\n');
console.log('V2_DEMO_CONFIGURED public model proxy; snapshots disabled');

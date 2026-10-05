const {Client}=require('../node_modules/firebase-tools/lib/apiv2');
const {requireAuth}=require('../node_modules/firebase-tools/lib/requireAuth');
const {getGlobalDefaultAccount}=require('../node_modules/firebase-tools/lib/auth');
async function connect(){const account=getGlobalDefaultAccount();if(!account)throw Error('Run firebase login');await requireAuth({project:'uirun-92539',...account});return (origin,version)=>new Client({urlPrefix:origin,apiVersion:version});}
module.exports={connect,project:'uirun-92539',number:'722420678096'};

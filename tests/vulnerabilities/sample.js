var EtsyClient = require('node-etsy-client');
async function doIt() {
    var client = new EtsyClient();
    var shops = await client.findAllShops({'shop_name':'mony', limit:10});
    console.log(shops);
}
if (false)
    doIt();

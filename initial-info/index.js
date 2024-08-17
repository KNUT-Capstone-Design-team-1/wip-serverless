const functions = require('@google-cloud/functions-framework');

functions.http('helloHttp', (req, res) => {
    switch (req.method) {
        case 'GET': {
            const initialInfo = {
                'appVersion': '2.0.1',
                'resourceDate': '2024-08-17',
                };
                
            res.status(200).json(initialInfo);
            break;
        }
        
        default: {
            res.status(405).send();
            break;
        }
  }
});

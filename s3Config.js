require('dotenv').config();
const { S3Client } = require('@aws-sdk/client-s3');

const s3Config = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
    },
});

// if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
//     console.error("❌ AWS Credentials missing from .env file!");
//     console.log("AWS_ACCESS_KEY_ID:", process.env.AWS_ACCESS_KEY_ID ? "SET" : "MISSING");
//     console.log("AWS_SECRET_ACCESS_KEY:", process.env.AWS_SECRET_ACCESS_KEY ? "SET" : "MISSING");
//     console.log("AWS_REGION:", process.env.AWS_REGION);
//     console.log("AWS_BUCKET_NAME:", process.env.AWS_BUCKET_NAME);
// }

module.exports = s3Config;

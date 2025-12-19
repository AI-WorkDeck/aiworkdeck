const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper to remove directory recursively
function removeDir(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach((file, index) => {
            const curPath = path.join(dirPath, file);
            if (fs.lstatSync(curPath).isDirectory()) { // recurse
                removeDir(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dirPath);
        console.log(`Successfully removed: ${dirPath}`);
    } else {
        console.log(`Directory not found (nothing to clean): ${dirPath}`);
    }
}

const appName = 'checkba-desktop'; // Must match name in package.json or app.name
let userDataPath;

if (process.platform === 'darwin') {
    userDataPath = path.join(os.homedir(), 'Library', 'Application Support', appName);
} else if (process.platform === 'win32') {
    userDataPath = path.join(os.homedir(), 'AppData', 'Roaming', appName);
} else {
    userDataPath = path.join(os.homedir(), '.config', appName);
}

console.log(`Cleaning user data at: ${userDataPath}`);

try {
    removeDir(userDataPath);
    console.log('Clean complete. You can now restart the app with "npm run dev".');
} catch (err) {
    console.error(`Error cleaning directory: ${err.message}`);
}

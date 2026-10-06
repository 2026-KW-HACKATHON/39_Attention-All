// App Check 네이티브 모듈은 앱 시작 때 기본 Firebase 앱(google-services.json)을 바로 찾는다.
// 파일이 없는 Emulator 개발 빌드에서는 이 모듈을 빼야 앱이 뜬다(Emulator 대상은 App Check를 쓰지 않는다).
const fs = require('node:fs');
const path = require('node:path');

const hasGoogleServices = fs.existsSync(path.join(__dirname, 'google-services.json'));

module.exports = {
  dependencies: hasGoogleServices ? {} : { '@react-native-firebase/app-check': { platforms: { android: null, ios: null } } },
};

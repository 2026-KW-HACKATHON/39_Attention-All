const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
// 백엔드가 관리하는 공개 연결 상수·연결 점검(backend/client)을 복사하지 않고 그대로 번들에 넣는다.
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../backend/client')];
module.exports = config;

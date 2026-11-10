const { binary } = require('../tests/helpers/database.cjs');
process.env.MONGOMS_RUNTIME_DOWNLOAD = 'true';
const { MongoBinary } = require('mongodb-memory-server-core');
MongoBinary.getPath(binary).then(() => console.log(`MongoDB ${binary.version} test binary ready`)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

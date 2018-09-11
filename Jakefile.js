
const dir = {
  src: 'src',
  out: 'dist',
  gen: 'gen'
};

const protos = [
  'payload'
];

const protobufJs  = 'protobuf.js';
const protobufDts = 'protobuf.d.ts';

//

const _ = require('lodash');
const path = require('path');

desc('Creates the output directory.');
directory(dir.out);

desc('Creates the generated code directory.');
directory(dir.gen);

(() => {
  const pb = require('protobufjs/cli');

  const protoSrcs = _.map(protos, name => path.join(dir.src, name + '.proto'));
  const outJs  = path.join(dir.out, protobufJs);
  const genDts = path.join(dir.gen, protobufDts);

  desc('Generates static protobuf code.');
  file(outJs, [dir.out, ...protoSrcs], {async: true}, () => {
    jake.logger.log('Generating static protobuf code...');
    pb.pbjs.main([
      '-t', 'static-module', '-w', 'commonjs',
      ...protoSrcs, '-o', outJs
    ], function(err) {
      if (err) throw err;
      complete();
    });
  });

  desc('Generates protobuf declarations.');
  file(genDts, [dir.gen, outJs], {async: true}, () => {
    jake.logger.log('Generating protobuf declarations...');
    pb.pbts.main([outJs, '-o', genDts], function(err) {
      if (err) throw err;
      complete();
    });
  });

  task('protobuf', [outJs, genDts], () => {
    jake.cpR(genDts, dir.out);
  });
})();

desc('Compiles typescript.');
task('compile', [dir.out, 'protobuf'], {async: true}, () => {
  jake.logger.log('Compiling typescript...');
  jake.exec('tsc', complete, {printStdout: true, printStderr: true});
});

desc('Creates a browser bundle.');
task('bundle', ['compile'], {async: true}, () => {
  jake.logger.log('Bundling...');
  jake.exec('webpack', complete, {printStdout: true, printStderr: true});
});

desc('Builds everything.');
task('default', ['compile']);

desc('Cleans the build tree.');
task('clean', () => {
  jake.rmRf(dir.out);
  jake.rmRf(dir.gen);
});


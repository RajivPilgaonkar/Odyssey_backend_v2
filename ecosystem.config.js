module.exports = {
  apps : [{
    name: 'vivaphysics_dev',
    script: 'app.js',
    watch: '.',
    env: {
      "NODE_ENV": "development",
    },    
    out_file: './log/out.log',
    error_file: './log/err.log',
  }, {
    name: 'vivaphysics_prod',
    script: 'app.js',
    watch: '.',
    env: {
      "NODE_ENV": "production",
    },    
    out_file: './log/out.log',
    error_file: './log/err.log'
  }],

};

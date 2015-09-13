// Configure gulp scripts
// Output application name
var appName = 'SimulationService';
var path2csWeb = '../../csWeb/';

var gulp = require('gulp'),
    del = require('del'),
    insert = require('gulp-insert'),
    rename = require('gulp-rename'),
    plumber = require('gulp-plumber'),
    watch = require('gulp-watch'),
    changed = require('gulp-changed'),
    gulpif = require('gulp-if');

gulp.task('clean', function(cb) {
    // NOTE Careful! Removes all generated javascript files and certain folders.
    del([
        path2csWeb + 'csServerComp/ServerComponents/**/*.js',
        path2csWeb + 'csComp/js/**',
    ], {
        force: true
    }, cb);
});

gulp.task('copy_csServerComp', function() {
    gulp.src(path2csWeb + 'csServerComp/ServerComponents/**/*.js')
        .pipe(changed('./ServerComponents'))
        .pipe(gulp.dest('./ServerComponents'));
    gulp.src(path2csWeb + 'csServerComp/ServerComponents/**/*.d.ts')
        .pipe(changed('./ServerComponents'))
        .pipe(gulp.dest('./ServerComponents'));
});

gulp.task('copy_csServerComp_scripts', function() {
    return gulp.src(path2csWeb + 'csServerComp/Scripts/**/*.ts')
        .pipe(changed('./Scripts'))
        .pipe(gulp.dest('./Scripts'));
});

gulp.task('create_dist_of_server', function() {
    gulp.src('node_modules/express/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/express/'));
    gulp.src('node_modules/body-parser/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/body-parser/'));
    gulp.src('node_modules/serve-favicon/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/serve-favicon/'));
    gulp.src('node_modules/rootpath/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/rootpath/'));
    gulp.src('node_modules/proj4/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/proj4/'));
    gulp.src('node_modules/socket.io/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/socket.io/'));
    gulp.src('node_modules/chokidar/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/chokidar/'));
    gulp.src('node_modules/pg/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/node_modules/pg/'));
    gulp.src('SimulationService/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/SimulationService/'));
    gulp.src('ServerComponents/**/*.*')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/ServerComponents/'));
    gulp.src('server.js')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/'));
    gulp.src('configuration.json')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/'));
    gulp.src('./public/favicon.ico')
        .pipe(plumber())
        .pipe(gulp.dest('./dist/public/'));
});

gulp.task('watch', function() {
    gulp.watch(path2csWeb + 'csServerComp/ServerComponents/**/*.js', ['copy_csServerComp']);
    gulp.watch(path2csWeb + 'csServerComp/Scripts/**/*.ts', ['copy_csServerComp_scripts']);
});

gulp.task('all', ['copy_csServerComp_scripts', 'copy_csServerComp']);

gulp.task('deploy', ['create_dist_of_server']);

gulp.task('default', ['all', 'watch']);

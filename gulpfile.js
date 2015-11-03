// Configure gulp scripts
// Output application name
var appName = 'csComp';
var path2csWeb = '../../csWeb/';
// var destinationPath = './SimulationManager/';
var destinationPath = './all/';

var gulp = require('gulp'),
    del = require('del'),
    insert = require('gulp-insert'),
    rename = require('gulp-rename'),
    plumber = require('gulp-plumber'),
    concat = require('gulp-concat'),
    watch = require('gulp-watch'),
    changed = require('gulp-changed'),
    templateCache = require('gulp-angular-templatecache'),
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

gulp.task('built_csComp', function() {
    return gulp.src(path2csWeb + 'csComp/js/**/*.js')
        // .pipe(debug({
        //     title: 'built_csComp:'
        // }))
        // .pipe(debug({title: 'before ordering:'}))
        // .pipe(order([
        //     "translations/locale-nl.js"
        // ]))
        // .pipe(debug({title: 'after ordering:'}))
        .pipe(concat('csComp.js'))
        .pipe(gulp.dest(destinationPath + 'public/cs/js'));
});

gulp.task('built_csComp.d.ts', function() {
    gulp.src(path2csWeb + 'csComp/js/**/*.d.ts')
        // .pipe(debug({title: 'before ordering:'}))
        // .pipe(order([
        //     "translations/locale-nl.js"
        // ]))
        // .pipe(debug({title: 'after ordering:'}))
        .pipe(plumber())
        .pipe(concat('csComp.d.ts'))
        .pipe(insert.prepend('/// <reference path="../leaflet/leaflet.d.ts" />\r\n'))
        .pipe(insert.prepend('/// <reference path="../crossfilter/crossfilter.d.ts" />\r\n'))
        .pipe(changed('Scripts/typings/cs'))
        .pipe(gulp.dest('Scripts/typings/cs'));
});

gulp.task('create_templateCache', function() {
    console.log('Creating templateCache.')
    var options = {
        module: appName,
        filename: 'csTemplates.js'
    }

    gulp.src(path2csWeb + 'csComp/**/*.tpl.html')
        // .pipe(debug({
        //     title: 'create_templateCache:'
        // }))
        .pipe(templateCache(options))
        .pipe(gulp.dest(destinationPath + 'public/cs/js'))
})

gulp.task('include_js', function() {
    gulp.src(path2csWeb + 'csComp/includes/js/**/*.*')
        // .pipe(debug({
        //     title: 'include_js:'
        // }))
        .pipe(plumber())
        .pipe(changed(destinationPath + 'public/cs/js/'))
        .pipe(gulp.dest(destinationPath + 'public/cs/js'));
});

gulp.task('include_css', function() {
    gulp.src(path2csWeb + 'csComp/includes/css/*.*')
        .pipe(plumber())
        .pipe(changed(destinationPath + 'public/cs/css/'))
        .pipe(gulp.dest(destinationPath + 'public/cs/css'));
});

gulp.task('include_images', function() {
    gulp.src(path2csWeb + 'csComp/includes/images/**/*.*')
        .pipe(plumber())
        .pipe(changed(destinationPath + 'public/cs/images/'))
        .pipe(gulp.dest(destinationPath + 'public/cs/images/'));
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

    gulp.watch(path2csWeb + 'csComp/js/**/*.js', ['built_csComp']);
    gulp.watch(path2csWeb + 'csComp/js/**/*.d.ts', ['built_csComp.d.ts']);
    gulp.watch(path2csWeb + 'csComp/**/*.tpl.html', ['create_templateCache']);
    gulp.watch(path2csWeb + 'csComp/includes/**/*.css', ['include_css']);
    gulp.watch(path2csWeb + 'csComp/includes/**/*.js', ['include_js']);
    gulp.watch(path2csWeb + 'csComp/includes/images/*.*', ['include_images']);
});

gulp.task('all', ['copy_csServerComp_scripts', 'copy_csServerComp', 'built_csComp', 'built_csComp.d.ts', 'create_templateCache', 'include_css', 'include_js', 'include_images']);

gulp.task('deploy', ['create_dist_of_server']);

gulp.task('default', ['all', 'watch']);

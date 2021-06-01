#!/usr/bin/env ts-node
"use strict";
/**
 * Thanks to https://gist.github.com/jgcmarins/3bfd75b7978acb7d7b1c97a8564d2e64
 */
const REF = 'master';

const fs = require("fs").promises;
const path = require("path");
const os = require('os');

const _ = require("lodash");
//var argv = require('minimist')(process.argv.slice(2));
const term = require('terminal-kit').terminal;
const semver = require('semver');
const changelogParser = require("changelog-parser");
//import changelog from 'generate-changelog';
const TOML = require("@iarna/toml");
const { Octokit } = require("@octokit/rest");
//import { exec as execCb } from 'child_process';
//import util from 'util';
//const exec = util.promisify(execCb);

// npm --no-git-tag-version version from-git

const target_commitish = "master";
const gitTokenFileName = ".gittoken";
const changelogFileName = "CHANGELOG.md";

const packageJson = async (octo, repo, { path = 'package.json' } = {}) => {
    const response = await octo.repos.getContent({ path, ...repo });
    const version = JSON.parse(Buffer.from(response.data.content, "base64")).version;
    return version;
}

const cargoToml = async (octo, repo, { path = 'Cargo.toml' } = {}) => {
    const response = await octo.repos.getContent({ ref: REF, path, ...repo });
    const version = TOML.parse(Buffer.from(response.data.content, "base64")).package.version;
    return version;
}

const more = (text) => {
    return text;
}

//TODO: class
const reposFn = {
//    "tonlabs/ton-q-server": packageJson,
//    "tonlabs/ton-sdk": async (octo, repo) => await cargoToml(octo, repo, { path: "ton_client/Cargo.toml" }),
//    "tonlabs/ton-client-js": async (octo, repo) => await packageJson(octo, repo, { path: "packages/core/package.json" }),
    "tonlabs/tonos-se": async (octo, repo) => await cargoToml(octo, repo, { path: "ton-node-se/ton_node_startup/Cargo.toml" }),
//    "tonlabs/tondev": packageJson,
//    "tonlabs/appkit-js": packageJson,
/*
    "tonlabs/ton-client-rs": cargoToml,
    "tonlabs/ton-client-web-js": packageJson,
    "tonlabs/ton-client-node-js": packageJson,
    "tonlabs/ton-client-react-native-js": packageJson,
*/
};
const repoNames = Object.keys(reposFn);

const singleColumnMenuAsync = model => {
  return new Promise((res, rej) => {
    term.singleColumnMenu(
      model,
      (err, input) => {
        if (err) { rej(err) }
        res(input.selectedText)
      }
    )
  })
}

const yesOrNoAsync = model => {
  return new Promise((res, rej) => {
    term.yesOrNo(
      model,
      (err, answer) => {
        if (err) { rej(err) }
        res(answer)
      }
    )
  })
}

const inputFieldAsync = () => {
  return new Promise((res, rej) => {
    term.inputField(
      (err, input) => {
        if (err) { rej(err) }
        res(input)
      }
    )
  })
}

(async function main() {
    const changelog = await changelogParser(changelogFileName);
    if (!(changelog && changelog.versions && changelog.versions.length > 0)) {
        throw Error(`FAILED: Not found versions at ${changelogFileName}`);
    }
    const {version, title, body} = changelog.versions[0];
    const bodyRelease = '## ' + title + '\n' + body;
    let auth;
    try {
        auth = await fs.readFile(path.resolve(os.homedir(), gitTokenFileName));
        auth = auth.toString().trim();
    } catch(err) {
        auth = process.env.GITHUB_TOKEN;
    };
    if (auth === undefined) {
        throw Error(`FAILED: Not found auth token at env.GITHUB_TOKEN or ${gitTokenFileName}`);
    }
    const octokit = new Octokit({auth}); //
    const repoList = repoNames.map(name => {
        const [owner, repo] = name.split('/');
        return {owner, repo};
    });
    term.on( 'key' , key => {
        if ( key === 'CTRL_C' ) {
            term('\n');
            term.grabInput( false ) ;
            process.exit() ;
        }
    });
    term.fullscreen({ noAlternate: false });
    while(true) {
        term.moveTo(0, 3).eraseDisplayBelow();
        term.bold("TARGET\n").styleReset("branch: ").bold.yellow(target_commitish + '\n\n');
        term.bold("CURRENT\n").styleReset("Version: ").bold.green(version + '\n').gray(more(bodyRelease) + '\n\n');
        const reposKit = await Promise.all(repoList.map(repo => octokit.repos.listReleases({ per_page: 1, ...repo }).catch(err => console.error('fail', err))));
        const reposAct = await Promise.all(repoList.map(repo => reposFn[repo.owner+'/'+repo.repo](octokit, repo)));
        //console.log('DEBUG:', _.get(reposKit, '[0].data[0]'));
        const reposLastRelease = _.map(reposKit, _.property('data[0].tag_name'));
        const repos = _.zip(repoNames, reposLastRelease, reposAct).map(triple => {
            const [name, version, actual] = triple;
            return {name, version, actual};
        });
        //term.on('submit');
        //term.saveCursor();
        //term.moveTo(0, term.height-1, "Submit: %s" , data.selectedText);
        //term.restoreCursor();
        term.bold("LATEST\n")
        repos.forEach(repo => {
            term.white(repo.name).white(": ");
            if (repo.version) {
                term.green(repo.version);
            } else {
                term.gray('unknown');
            }
            term(' ')
            if (repo.version === repo.actual) {
                term.cyan(repo.actual);
            } else if (semver.gt(repo.version, repo.actual)) {
                term.brightRed(repo.actual);
            } else {
                term.brightYellow(repo.actual);
            }
            term('\n');
        });
        term('\n');

        const repoName = await singleColumnMenuAsync(repoNames); //, {continueOnSubmit: true}
        term.gray(`Release ${repoName}? [y/N]`);
        const release = await yesOrNoAsync({yes: ['y'], no: ['n', 'ENTER']});
        if (release) {
            term.yellow('\nStarting release...\n');
            const idx = repoNames.indexOf(repoName);
            const repo = repoList[idx];
            //console.log(repo);
            if (repos[idx].version == version) {
                term.bold.yellow('WARNING!').white(' version already exists\n');
            } else if (semver.gt(repos[idx].version, version)) {
                term.bold.yellow('WARNING!').white(' attempt to downgrade\n');
            } else {
                const res = await octokit.repos.createRelease({
                    draft: false,
                    prerelease: false,
                    body: bodyRelease,
                    target_commitish: REF, // TODO:
                    name: `Version: ${version}`,
                    tag_name: version,
                    ...repo
                });
                if (res.data) {
                    term.cyan(_.get(res, 'data.html_url') + '\n');
                } else {
                    term.error.bold.red('FAILED\n');
                    console.error(res);
                }
            }
            term.white("Press ENTER to continue.");
            await inputFieldAsync();
        }
    }
})().catch(err => {term.error.bold.red(err + '\n');});

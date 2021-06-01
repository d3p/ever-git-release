#!/usr/bin/env ts-node
"use strict";
/**
 * Thanks to https://gist.github.com/jeremyjs/40a95359dd9a490b7139d1ac1e64e24f
 */

const fs = require("fs").promises;
const path = require("path");
const os = require('os');

const _ = require("lodash");
const term = require('terminal-kit').terminal;
const simpleGit = require("simple-git");
const shell = require("shelljs");
const semver = require('semver');
const changelogParser = require("changelog-parser");
const TOML = require("@iarna/toml");
const { Octokit } = require("@octokit/rest");
const gh = require('parse-github-url')

// npm --no-git-tag-version version from-git

const git = simpleGit();
const gitTokenFileName = ".gittoken";

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
    term.on( 'key' , key => {
        if ( key === 'CTRL_C' ) {
            term('\n');
            term.grabInput( false ) ;
            process.exit() ;
        }
    });
    const remote = await git.remote(['get-url', 'origin']);
    const remoteObj = gh(remote.trim());
    const result = await octokit.repos.listReleases({ owner: remoteObj.owner, repo: remoteObj.name, per_page: 1 });
    const tag_name = _.get(result, 'data[0].tag_name');

    term.fullscreen({ noAlternate: false });
    while(true) {
        term.moveTo(0, 3).eraseDisplayBelow();
        term.bold("LATEST\n").styleReset("Tag: ").bold.green(tag_name + '\n\n');

        const menu = ['patch', 'minor', 'major'].map(semver.inc.bind(semver, tag_name));
        const newTagName = await singleColumnMenuAsync(menu);

        term.gray(`Update version ${newTagName}? [y/N]`);

        const yes = await yesOrNoAsync({yes: ['y'], no: ['n', 'ENTER']});
        if (yes) {
            term('\n');
            const { code, stdout, stderr } = shell.exec(`npm --no-git-tag-version --allow-same-version version ${newTagName}`, { silent: true });
            if (code === 0) {
                term.yellow("Version updated:\n");
                term.gray(stdout);
            } else {
                term.bold.red(stderr);
            }
            term.white("\nPress ENTER to continue.");
            await inputFieldAsync();
            const currentBranchName = (await git.branch()).current; // git rev-parse --abbrev-ref HEAD
            console.log(`#${currentBranchName}#`);
            const releaseBranchName = `${newTagName}-rc`;
            if (currentBranchName !== releaseBranchName) {
                term.gray("Current branch: ").yellow(`${currentBranchName}\n`);
                term.gray("Create new release branch: ").green(releaseBranchName).gray("? [y/N]");
                const yesBranch = await yesOrNoAsync({yes: ['y'], no: ['n', 'ENTER']});
                if (yesBranch) {
                    term('\n');
                    git.checkout(['-b', releaseBranchName]);
                    term.white("\nPress ENTER to continue.");
                    await inputFieldAsync();
                }
            }
        }
    }
})().catch(err => {term.error.bold.red(err + '\n');});

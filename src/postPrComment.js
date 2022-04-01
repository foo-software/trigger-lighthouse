import fetch from './fetch';
import getLighthouseScoreColor from './helpers/getLighthouseScoreColor';
import lighthouseAuditTitles from './lighthouseAuditTitles';
import LighthouseCheckError from './LighthouseCheckError';
import { ERROR_UNEXPECTED_RESPONSE } from './errorCodes';
import { NAME } from './constants';

const getBadge = ({ title, score }) =>
  `![](https://img.shields.io/badge/${title}-${score}-${getLighthouseScoreColor(
    {
      isHex: false,
      score
    }
  )}?style=flat-square) `;

export default async ({
  isGitHubAction,
  isLocalAudit,
  isOrb,
  prCommentAccessToken,
  prCommentSaveOld,
  prCommentUrl,
  results,
  verbose
}) => {
  try {
    let markdown = '';

    // we'll create a way to uniquely identify a comment so that we don't edit
    // the wrong one
    const commentIds = [];

    results.forEach(result => {
      commentIds.push(
        result.id || `${result.emulatedFormFactor}:${result.url}`
      );

      // badges
      Object.keys(result.scores).forEach(current => {
        markdown += getBadge({
          title: lighthouseAuditTitles[current].replace(/ /g, '%20'),
          score: result.scores[current]
        });
      });

      // table header
      markdown += `\n| Device ${!result.report ? '' : `| Report `}| URL |\n`;
      markdown += `|--${!result.report ? '' : `|--`}|--|\n`;

      // the emulatedformfactor
      markdown += `| ${result.emulatedFormFactor} `;

      // if we have a URL for the full report
      if (result.report) {
        markdown += `| [report](${result.report}) `;
      }

      // the url
      markdown += `| ${result.url} |\n\n`;
    });

    if (isLocalAudit) {
      markdown += 'Not what you expected? Are your scores flaky? ';

      if (isGitHubAction) {
        markdown += '**GitHub runners could be the cause.**\n';
      } else if (isOrb) {
        markdown += '**CircleCI runners could be the cause.**\n';
      }

      markdown += `[Try running on Foo instead]`;

      if (isGitHubAction) {
        markdown +=
          '(https://www.foo.software/docs/lighthouse-check-github-action/examples#running-on-foo-and-saving-results)\n';
      } else if (isOrb) {
        markdown +=
          '(https://github.com/foo-software/lighthouse-check-orb#usage-foo-api)\n';
      } else {
        markdown +=
          '(https://github.com/foo-software/lighthouse-check#foos-automated-lighthouse-check-api-usage)\n';
      }
    }

    // create an identifier within the comment when searching comments
    // in the future
    const commentIdentifierPrefix = '<!-- generated by lighthouse-check -->';
    const commentIdentifier = `\n<!-- COMMENT_ID${JSON.stringify(
      commentIds
    )}COMMENT_ID -->`;
    markdown += commentIdentifierPrefix + commentIdentifier;

    // establish existing comment
    let existingComment;

    // if we aren't saving old comments
    if (!prCommentSaveOld) {
      // get existing comments to see if we've already posted scores
      const existingCommentsResult = await fetch(prCommentUrl, {
        method: 'get',
        headers: {
          'content-type': 'application/json',
          authorization: `token ${prCommentAccessToken}`
        }
      });
      const existingCommentsJsonResult = await existingCommentsResult.json();

      if (
        Array.isArray(existingCommentsJsonResult) &&
        existingCommentsJsonResult.length
      ) {
        existingComment = existingCommentsJsonResult.find(current => {
          const hasLighthouseComment = current.body.includes(
            commentIdentifierPrefix
          );
          if (!hasLighthouseComment) {
            return false;
          }

          // check to see if this comment matches the current result set
          const [, commentIdsFromExistingCommentString] = current.body.split(
            'COMMENT_ID'
          );

          if (!commentIdsFromExistingCommentString) {
            return false;
          }

          const commentIdsFromExistingComment = JSON.parse(
            commentIdsFromExistingCommentString
          );

          // if one has more results than the other then we are definitely different
          if (commentIdsFromExistingComment.length !== commentIds.length) {
            return false;
          }

          // if any result id is not found in the other then we have a diff
          for (const commentId of commentIds) {
            if (!commentIdsFromExistingComment.includes(commentId)) {
              return false;
            }
          }

          return true;
        });
      }
    }

    // create or update the comment with scores
    const shouldUpdate = existingComment && existingComment.id;
    const url = !shouldUpdate
      ? prCommentUrl
      : `${prCommentUrl}/${existingComment.id}`;

    const result = await fetch(url, {
      method: !shouldUpdate ? 'post' : 'put',
      body: JSON.stringify({
        ...(shouldUpdate
          ? {}
          : {
              event: 'COMMENT'
            }),
        body: markdown
      }),
      headers: {
        'content-type': 'application/json',
        authorization: `token ${prCommentAccessToken}`
      }
    });
    const jsonResult = await result.json();

    if (!jsonResult.id) {
      throw new LighthouseCheckError(
        jsonResult.message || 'something went wrong',
        {
          code: ERROR_UNEXPECTED_RESPONSE,
          data: jsonResult
        }
      );
    }
  } catch (error) {
    if (verbose) {
      console.log(`${NAME}:`, error);
    }

    // we still need to kill the process
    throw error;
  }
};

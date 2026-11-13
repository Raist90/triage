package github

// listFields is the GraphQL selection for one PR row. The indentation matches
// the literal in buildListQuery.
const listFields = `        number
        title
        url
        updatedAt
        isDraft
        state
        headRefName
        reviewDecision
        author { login }
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
`

// prNodeIDQuery resolves the GraphQL node ID a draft mutation needs. REST has
// no endpoint for changing draft state.
const prNodeIDQuery = `query PRNodeID($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id }
  }
}
`

const markReadyMutation = `mutation MarkReady($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) {
    pullRequest { isDraft }
  }
}
`

const convertToDraftMutation = `mutation ConvertToDraft($id: ID!) {
  convertPullRequestToDraft(input: { pullRequestId: $id }) {
    pullRequest { isDraft }
  }
}
`

// detailQuery fetches everything the detail header needs. Diffs come from REST.
const detailQuery = `query PRDetail($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      title
      url
      body
      state
      isDraft
      mergeable
      mergeStateStatus
      headRefName
      headRefOid
      baseRefName
      reviewDecision
      viewerLatestReview { state }
      createdAt
      updatedAt
      additions
      deletions
      changedFiles
      author { login }
      repository { nameWithOwner squashMergeAllowed }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      comments(first: 100) {
        nodes { author { login } body createdAt }
      }
      reviews(first: 50) {
        nodes {
          author { login }
          state
          body
          createdAt
        }
      }
      reviewThreads(first: 50) {
        nodes {
          path
          line
          comments(first: 20) {
            nodes { author { login } body createdAt }
          }
        }
      }
    }
  }
}
`

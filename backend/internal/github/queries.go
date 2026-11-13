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
      headRefName
      headRefOid
      baseRefName
      reviewDecision
      viewerLatestReview { state }
      updatedAt
      additions
      deletions
      changedFiles
      author { login }
      repository { nameWithOwner }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      comments(first: 100) {
        nodes { author { login } body createdAt }
      }
      reviewThreads(first: 50) {
        nodes {
          comments(first: 20) {
            nodes { author { login } body createdAt }
          }
        }
      }
    }
  }
}
`

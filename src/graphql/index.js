const { loadFilesSync } = require('@graphql-tools/load-files');
const { mergeResolvers, mergeTypeDefs } = require('@graphql-tools/merge');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { resolvers: scalarResolvers, typeDefs: scalarTypeDefs } = require('graphql-scalars');
const path = require('path');

const typesArray = loadFilesSync(path.join(__dirname, './types'), {
  recursive: true,
  extensions: ['graphql'],
});

const resolversArray = loadFilesSync(path.join(__dirname, './resolvers'), {
  recursive: true,
});

const typeDefs = mergeTypeDefs(typesArray.concat(...scalarTypeDefs));
const resolvers = mergeResolvers(resolversArray.concat(scalarResolvers));

const executableSchema = makeExecutableSchema({
  typeDefs,
  resolvers,
});

module.exports = executableSchema;

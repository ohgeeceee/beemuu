"use strict";

const { buildCreateTableSql, buildEmbeddingTableSql } = require("./sql");

module.exports = {
  dtcCatalogPostgres: buildCreateTableSql,
  dtcEmbeddingPostgres: buildEmbeddingTableSql
};

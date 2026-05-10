const sql = require('mssql');
const { LogHelper } = require('../../core/utils/LogHelper.cjs')

class NotionRepository{
    constructor(pool){
        this.pool = pool
        this.logger = new LogHelper('NotionRepository');
    }
}
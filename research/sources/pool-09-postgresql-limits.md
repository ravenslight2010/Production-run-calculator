Source: https://www.postgresql.org/docs/current/limits.html
Title: PostgreSQL: Documentation: 18: Appendix K. PostgreSQL Limits
Fetched: 2026-09-19T16:08:10.727Z

August 13, 2026: [PostgreSQL 18.6, 17.11, 16.15, 15.19, 14.24 and 19 Beta 3 Released!](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/)

[Documentation](https://www.postgresql.org/docs/ "Documentation") → [PostgreSQL 18](https://www.postgresql.org/docs/18/index.html)

Supported Versions:



[Current](https://www.postgresql.org/docs/current/limits.html "PostgreSQL 18 - Appendix K. PostgreSQL Limits")
( [18](https://www.postgresql.org/docs/18/limits.html "PostgreSQL 18 - Appendix K. PostgreSQL Limits"))


/

[17](https://www.postgresql.org/docs/17/limits.html "PostgreSQL 17 - Appendix K. PostgreSQL Limits")


/

[16](https://www.postgresql.org/docs/16/limits.html "PostgreSQL 16 - Appendix K. PostgreSQL Limits")


/

[15](https://www.postgresql.org/docs/15/limits.html "PostgreSQL 15 - Appendix K. PostgreSQL Limits")


/

[14](https://www.postgresql.org/docs/14/limits.html "PostgreSQL 14 - Appendix K. PostgreSQL Limits")

Development Versions:


[19](https://www.postgresql.org/docs/19/limits.html "PostgreSQL 19 - Appendix K. PostgreSQL Limits")

/
[devel](https://www.postgresql.org/docs/devel/limits.html "PostgreSQL devel - Appendix K. PostgreSQL Limits")

Unsupported versions:


[13](https://www.postgresql.org/docs/13/limits.html "PostgreSQL 13 - Appendix K. PostgreSQL Limits")

/
[12](https://www.postgresql.org/docs/12/limits.html "PostgreSQL 12 - Appendix K. PostgreSQL Limits")

| Appendix K. PostgreSQL Limits |
| :-: |
| [Prev](https://www.postgresql.org/docs/current/docguide-style.html "J.6. Style Guide") | [Up](https://www.postgresql.org/docs/current/appendixes.html "Part VIII. Appendixes") | Part VIII. Appendixes | [Home](https://www.postgresql.org/docs/current/index.html "PostgreSQL 18.6 Documentation") | [Next](https://www.postgresql.org/docs/current/acronyms.html "Appendix L. Acronyms") |

* * *

## Appendix K. PostgreSQL Limits

[Table K.1](https://www.postgresql.org/docs/current/limits.html#LIMITS-TABLE "Table K.1. PostgreSQL Limitations") describes various hard limits of PostgreSQL. However, practical limits, such as performance limitations or available disk space may apply before absolute hard limits are reached.

**Table K.1. PostgreSQL Limitations**

| Item | Upper Limit | Comment |
| --- | --- | --- |
| database size | unlimited |  |
| number of databases | 4,294,950,911 |  |
| relations per database | 1,431,650,303 |  |
| relation size | 32 TB | with the default `BLCKSZ` of 8192 bytes |
| rows per table | limited by the number of tuples that can fit onto 4,294,967,295 pages |  |
| columns per table | 1,600 | further limited by tuple size fitting on a single page; see note below |
| columns in a result set | 1,664 |  |
| field size | 1 GB |  |
| indexes per table | unlimited | constrained by maximum relations per database |
| columns per index | 32 | can be increased by recompiling PostgreSQL |
| partition keys | 32 | can be increased by recompiling PostgreSQL |
| identifier length | 63 bytes | can be increased by recompiling PostgreSQL |
| function arguments | 100 | can be increased by recompiling PostgreSQL |
| query parameters | 65,535 |  |

The maximum number of columns for a table is further reduced as the tuple being stored must fit in a single 8192-byte heap page. For example, excluding the tuple header, a tuple made up of 1,600 `int` columns would consume 6400 bytes and could be stored in a heap page, but a tuple of 1,600 `bigint` columns would consume 12800 bytes and would therefore not fit inside a heap page. Variable-length fields of types such as `text`, `varchar`, and `char` can have their values stored out of line in the table's TOAST table when the values are large enough to require it. Only an 18-byte pointer must remain inside the tuple in the table's heap. For shorter length variable-length fields, either a 4-byte or 1-byte field header is used and the value is stored inside the heap tuple.

Columns that have been dropped from the table also contribute to the maximum column limit. Moreover, although the dropped column values for newly created tuples are internally marked as null in the tuple's null bitmap, the null bitmap also occupies space.

Each table can store a theoretical maximum of 2^32 out-of-line values; see [Section 66.2](https://www.postgresql.org/docs/current/storage-toast.html "66.2. TOAST") for a detailed discussion of out-of-line storage. This limit arises from the use of a 32-bit OID to identify each such value. The practical limit is significantly less than the theoretical limit, because as the OID space fills up, finding an OID that is still free can become expensive, in turn slowing down INSERT/UPDATE statements. Typically, this is only an issue for tables containing many terabytes of data; partitioning is a possible workaround.

* * *

|     |     |     |
| --- | --- | --- |
| [Prev](https://www.postgresql.org/docs/current/docguide-style.html "J.6. Style Guide") | [Up](https://www.postgresql.org/docs/current/appendixes.html "Part VIII. Appendixes") | [Next](https://www.postgresql.org/docs/current/acronyms.html "Appendix L. Acronyms") |
| J.6. Style Guide | [Home](https://www.postgresql.org/docs/current/index.html "PostgreSQL 18.6 Documentation") | Appendix L. Acronyms |

## Submit correction

If you see anything in the documentation that is not correct, does not match
your experience with the particular feature or requires further clarification,
please use
[this form](https://www.postgresql.org/account/comments/new/18/limits.html/)
to report a documentation issue.
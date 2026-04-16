using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using TrailBuddy.Api.Data;

namespace TrailBuddy.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class DataController : ControllerBase
{
    /// <summary>Cap for list endpoints; raise if you need full-table exports.</summary>
    private const int MaxListRows = 100_000;

    private readonly MySqlConnectionFactory _connectionFactory;
    private readonly IWebHostEnvironment _environment;

    public DataController(MySqlConnectionFactory connectionFactory, IWebHostEnvironment environment)
    {
        _connectionFactory = connectionFactory;
        _environment = environment;
    }

    [HttpGet("trips")]
    public Task<IActionResult> GetTrips(CancellationToken cancellationToken) =>
        QueryListOrDatabaseUnavailableAsync(
            ["hikingtrip", "hiking_trip", "trips", "trip", "hiking_trips", "hikes"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["tripid", "id", "trip_id"],
                ["name"] = ["tripname", "name", "trip_name", "title"],
                ["location"] = ["location", "trail_location", "park", "destination"],
                ["difficulty"] = ["difficultylevel", "difficulty", "difficulty_level", "level"],
                ["price"] = ["price", "trip_price", "cost"],
                ["distance"] = ["distance", "miles", "distance_miles"],
                ["date"] = ["date", "trip_date", "hike_date"],
                ["category"] = ["category", "trip_category", "type"],
                ["hikers"] = ["numberofhikers", "hikers", "number_of_hikers", "max_hikers", "group_size"],
                ["time"] = ["time", "start_time", "meeting_time"]
            },
            cancellationToken);

    [HttpGet("reservations")]
    public Task<IActionResult> GetReservations(CancellationToken cancellationToken) =>
        QueryListOrDatabaseUnavailableAsync(
            ["reservation", "reservations", "bookings", "booking"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["reservationid", "id", "reservation_id", "booking_id"],
                ["tripId"] = ["tripid", "trip_id"],
                ["customerId"] = ["customerid", "customer_id"],
                ["employeeId"] = ["employeeid", "employee_id"],
                ["date"] = ["reservationdate", "date", "booking_date"],
                ["seats"] = ["numberofhikers", "seats", "party_size"],
                ["status"] = ["resstatus", "status", "reservation_status", "booking_status"],
                ["time"] = ["reservationtime", "time", "booking_time"]
            },
            cancellationToken);

    [HttpGet("customers")]
    public Task<IActionResult> GetCustomers(CancellationToken cancellationToken) =>
        QueryListOrDatabaseUnavailableAsync(
            ["customer", "customers", "clients", "client"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["customerid", "id", "customer_id", "client_id"],
                ["fname"] = ["fname", "first_name", "firstname"],
                ["lname"] = ["lname", "last_name", "lastname"],
                ["email"] = ["email", "email_address"],
                ["birthday"] = ["birthday", "dob"],
                ["registrationdate"] = ["registrationdate", "registration_date", "created_at"]
            },
            cancellationToken);

    [HttpGet("employees")]
    public Task<IActionResult> GetEmployees(CancellationToken cancellationToken) =>
        QueryListOrDatabaseUnavailableAsync(
            ["employee", "employees", "staff"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["employeeid", "id", "employee_id", "staff_id"],
                ["role"] = ["role", "job_title", "position"],
                ["department"] = ["department", "team", "division"],
                ["salary"] = ["salary"],
                ["availability"] = ["availability"],
                ["email"] = ["email", "email_address"],
                ["birthday"] = ["birthday", "dob"],
                ["bonus"] = ["bonus"]
            },
            cancellationToken);

    [HttpGet("reports")]
    public Task<IActionResult> GetReports(CancellationToken cancellationToken) =>
        QueryListOrDatabaseUnavailableAsync(
            ["reports", "report"],
            new Dictionary<string, string[]>
            {
                ["title"] = ["title", "report_name", "name"],
                ["description"] = ["description", "details", "summary"],
                ["period"] = ["period", "time_period", "range_label"]
            },
            cancellationToken);

    [HttpGet("schema")]
    public async Task<IActionResult> GetSchema(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string tablesSql = """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = DATABASE()
                ORDER BY table_name;
                """;

            var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

            await using (var tableCmd = new MySqlCommand(tablesSql, connection))
            await using (var tableReader = await tableCmd.ExecuteReaderAsync(cancellationToken))
            {
                while (await tableReader.ReadAsync(cancellationToken))
                {
                    var table = tableReader.GetString(0);
                    result[table] = [];
                }
            }

            const string columnsSql = """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                ORDER BY table_name, ordinal_position;
                """;

            await using var colCmd = new MySqlCommand(columnsSql, connection);
            await using var colReader = await colCmd.ExecuteReaderAsync(cancellationToken);
            while (await colReader.ReadAsync(cancellationToken))
            {
                var table = colReader.GetString(0);
                var column = colReader.GetString(1);
                if (!result.ContainsKey(table))
                    result[table] = [];
                result[table].Add(column);
            }

            return Ok(result);
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    private async Task<IActionResult> QueryListOrDatabaseUnavailableAsync(
        IReadOnlyList<string> tableCandidates,
        IReadOnlyDictionary<string, string[]> outputColumns,
        CancellationToken cancellationToken)
    {
        try
        {
            var rows = await QueryEntityAsync(tableCandidates, outputColumns, cancellationToken);
            return Ok(rows);
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    private ObjectResult DatabaseUnavailable(MySqlException ex)
    {
        var detail = _environment.IsDevelopment() ? ex.Message : "Check connection string, VPN, and RDS security groups.";
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            error = "database_unavailable",
            message = detail
        });
    }

    private async Task<List<Dictionary<string, object?>>> QueryEntityAsync(
        IReadOnlyList<string> tableCandidates,
        IReadOnlyDictionary<string, string[]> outputColumns,
        CancellationToken cancellationToken)
    {
        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);

        var tableName = await FindTableNameAsync(connection, tableCandidates, cancellationToken);
        if (tableName is null)
            return [];

        var columns = await GetColumnsAsync(connection, tableName, cancellationToken);
        var available = new HashSet<string>(columns, StringComparer.OrdinalIgnoreCase);

        var selectParts = outputColumns
            .Select(kvp => BuildSelectPart(kvp.Key, kvp.Value, available))
            .ToArray();

        var sql = $"SELECT {string.Join(", ", selectParts)} FROM `{tableName}` LIMIT {MaxListRows};";
        await using var command = new MySqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                row[reader.GetName(i)] = value;
            }
            rows.Add(row);
        }

        return rows;
    }

    private static async Task<string?> FindTableNameAsync(
        MySqlConnection connection,
        IReadOnlyList<string> tableCandidates,
        CancellationToken cancellationToken)
    {
        if (tableCandidates.Count == 0)
            return null;

        const string sql = """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND LOWER(table_name) IN ({0})
            LIMIT 1;
            """;

        var parameterNames = tableCandidates.Select((_, i) => $"@p{i}").ToArray();
        var commandText = string.Format(sql, string.Join(", ", parameterNames));

        await using var command = new MySqlCommand(commandText, connection);
        for (var i = 0; i < tableCandidates.Count; i++)
        {
            command.Parameters.AddWithValue(parameterNames[i], tableCandidates[i].ToLowerInvariant());
        }

        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value as string;
    }

    private static async Task<List<string>> GetColumnsAsync(
        MySqlConnection connection,
        string tableName,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = @tableName;
            """;

        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@tableName", tableName);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var columns = new List<string>();
        while (await reader.ReadAsync(cancellationToken))
        {
            columns.Add(reader.GetString(0));
        }

        return columns;
    }

    private static string BuildSelectPart(string outputName, IEnumerable<string> candidates, HashSet<string> available)
    {
        var match = candidates.FirstOrDefault(candidate => available.Contains(candidate));
        if (string.IsNullOrWhiteSpace(match))
            return $"NULL AS `{outputName}`";

        return $"`{match}` AS `{outputName}`";
    }
}

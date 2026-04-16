using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using TrailBuddy.Api.Data;

namespace TrailBuddy.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class DataController : ControllerBase
{
    private readonly MySqlConnectionFactory _connectionFactory;

    public DataController(MySqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    [HttpGet("trips")]
    public async Task<IActionResult> GetTrips(CancellationToken cancellationToken)
    {
        var rows = await QueryEntityAsync(
            ["trips", "trip", "hiking_trips", "hikes"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["id", "trip_id", "tripid"],
                ["name"] = ["name", "trip_name", "title"],
                ["location"] = ["location", "trail_location", "park", "destination"],
                ["difficulty"] = ["difficulty", "difficulty_level", "level"],
                ["price"] = ["price", "trip_price", "cost"],
                ["distance"] = ["distance", "miles", "distance_miles"],
                ["date"] = ["date", "trip_date", "hike_date"],
                ["category"] = ["category", "trip_category", "type"],
                ["hikers"] = ["hikers", "number_of_hikers", "max_hikers", "group_size"],
                ["time"] = ["time", "start_time", "meeting_time"]
            },
            cancellationToken);

        return Ok(rows);
    }

    [HttpGet("reservations")]
    public async Task<IActionResult> GetReservations(CancellationToken cancellationToken)
    {
        var rows = await QueryEntityAsync(
            ["reservations", "reservation", "bookings", "booking"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["id", "reservation_id", "booking_id"],
                ["trip"] = ["trip", "trip_name", "trip_title"],
                ["customer"] = ["customer", "customer_name", "full_name"],
                ["date"] = ["date", "reservation_date", "booking_date"],
                ["seats"] = ["seats", "number_of_hikers", "hikers", "party_size"],
                ["status"] = ["status", "reservation_status", "booking_status"]
            },
            cancellationToken);

        return Ok(rows);
    }

    [HttpGet("customers")]
    public async Task<IActionResult> GetCustomers(CancellationToken cancellationToken)
    {
        var rows = await QueryEntityAsync(
            ["customers", "customer", "clients", "client"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["id", "customer_id", "client_id"],
                ["name"] = ["name", "customer_name", "full_name"],
                ["email"] = ["email", "email_address"],
                ["phone"] = ["phone", "phone_number"],
                ["city"] = ["city", "location", "home_city"]
            },
            cancellationToken);

        return Ok(rows);
    }

    [HttpGet("employees")]
    public async Task<IActionResult> GetEmployees(CancellationToken cancellationToken)
    {
        var rows = await QueryEntityAsync(
            ["employees", "employee", "staff"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["id", "employee_id", "staff_id"],
                ["name"] = ["name", "employee_name", "full_name"],
                ["role"] = ["role", "job_title", "position"],
                ["department"] = ["department", "team", "division"],
                ["email"] = ["email", "email_address"]
            },
            cancellationToken);

        return Ok(rows);
    }

    [HttpGet("reports")]
    public async Task<IActionResult> GetReports(CancellationToken cancellationToken)
    {
        var rows = await QueryEntityAsync(
            ["reports", "report"],
            new Dictionary<string, string[]>
            {
                ["title"] = ["title", "report_name", "name"],
                ["description"] = ["description", "details", "summary"],
                ["period"] = ["period", "time_period", "range_label"]
            },
            cancellationToken);

        return Ok(rows);
    }

    [HttpGet("schema")]
    public async Task<IActionResult> GetSchema(CancellationToken cancellationToken)
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

        var sql = $"SELECT {string.Join(", ", selectParts)} FROM `{tableName}` LIMIT 500;";
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

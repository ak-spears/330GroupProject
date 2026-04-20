using System.Globalization;
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

    public sealed record CreateTripRequest(
        string TripName,
        string Location,
        string Distance,
        string Date,
        decimal Price,
        int NumberOfHikers,
        string DifficultyLevel,
        string Category,
        string Time,
        int? EmployeeId);

    [HttpPost("trips")]
    public async Task<IActionResult> CreateTrip([FromBody] CreateTripRequest body, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(body.TripName)
            || string.IsNullOrWhiteSpace(body.Location)
            || string.IsNullOrWhiteSpace(body.Distance)
            || string.IsNullOrWhiteSpace(body.Date)
            || string.IsNullOrWhiteSpace(body.DifficultyLevel)
            || string.IsNullOrWhiteSpace(body.Category)
            || string.IsNullOrWhiteSpace(body.Time)
            || body.Price < 0
            || body.NumberOfHikers <= 0)
        {
            return BadRequest(new
            {
                error = "invalid_request",
                message = "TripName, Location, Distance, Date, DifficultyLevel, Category, Time are required. Price must be >= 0 and NumberOfHikers must be > 0."
            });
        }

        if (!DateOnly.TryParse(body.Date.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var tripDate))
            return BadRequest(new { error = "invalid_date", message = "Date must be YYYY-MM-DD." });

        if (!decimal.TryParse(body.Distance.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var distance)
            || distance < 0)
        {
            return BadRequest(new { error = "invalid_distance", message = "Distance must be a non-negative number." });
        }

        if (!TimeOnly.TryParse(body.Time.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var tripTime))
            return BadRequest(new { error = "invalid_time", message = "Time must be HH:mm (or HH:mm:ss)." });

        var employeeId = body.EmployeeId.HasValue && body.EmployeeId.Value > 0 ? body.EmployeeId.Value : (int?)null;

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            if (employeeId is not null)
            {
                const string verifyEmployeeSql = """
                    SELECT employeeid
                    FROM employee
                    WHERE employeeid = @id
                    LIMIT 1;
                    """;
                await using var verify = new MySqlCommand(verifyEmployeeSql, connection);
                verify.Parameters.AddWithValue("@id", employeeId.Value);
                var exists = await verify.ExecuteScalarAsync(cancellationToken);
                if (exists is null || exists is DBNull)
                    return BadRequest(new { error = "employee_not_found" });
            }

            const string insertSql = """
                INSERT INTO hikingtrip (tripname, location, distance, date, price, numberofhikers, difficultylevel, category, `time`)
                VALUES (@name, @location, @distance, @date, @price, @hikers, @difficulty, @category, @time);
                """;

            await using var insert = new MySqlCommand(insertSql, connection);
            insert.Parameters.AddWithValue("@name", body.TripName.Trim());
            insert.Parameters.AddWithValue("@location", body.Location.Trim());
            insert.Parameters.AddWithValue("@distance", distance);
            insert.Parameters.AddWithValue("@date", tripDate.ToDateTime(TimeOnly.MinValue));
            insert.Parameters.AddWithValue("@price", body.Price);
            insert.Parameters.AddWithValue("@hikers", body.NumberOfHikers);
            insert.Parameters.AddWithValue("@difficulty", body.DifficultyLevel.Trim());
            insert.Parameters.AddWithValue("@category", body.Category.Trim());
            insert.Parameters.AddWithValue("@time", tripTime.ToTimeSpan());

            await insert.ExecuteNonQueryAsync(cancellationToken);
            var newTripId = (int)insert.LastInsertedId;

            if (employeeId is not null)
            {
                const string superviseSql = """
                    INSERT INTO supervises (employeeid, tripid)
                    VALUES (@employeeId, @tripId)
                    ON DUPLICATE KEY UPDATE employeeid = employeeid;
                    """;
                await using var supervise = new MySqlCommand(superviseSql, connection);
                supervise.Parameters.AddWithValue("@employeeId", employeeId.Value);
                supervise.Parameters.AddWithValue("@tripId", newTripId);
                await supervise.ExecuteNonQueryAsync(cancellationToken);
            }

            return Ok(new
            {
                id = newTripId,
                name = body.TripName.Trim(),
                location = body.Location.Trim(),
                difficulty = body.DifficultyLevel.Trim(),
                price = body.Price,
                distance,
                date = tripDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                category = body.Category.Trim(),
                hikers = body.NumberOfHikers,
                time = tripTime.ToString("HH:mm:ss", CultureInfo.InvariantCulture),
                leaderEmployeeId = employeeId
            });
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    [HttpGet("trips/{tripId:int}/leaders")]
    public async Task<IActionResult> GetTripLeaders([FromRoute] int tripId, CancellationToken cancellationToken)
    {
        if (tripId <= 0)
            return BadRequest(new { error = "invalid_trip_id" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string sql = """
                SELECT e.employeeid,
                       e.role,
                       e.department,
                       e.availability,
                       e.email,
                       e.birthday
                FROM supervises s
                JOIN employee e ON e.employeeid = s.employeeid
                WHERE s.tripid = @tripId
                ORDER BY e.employeeid ASC;
                """;

            await using var command = new MySqlCommand(sql, connection);
            command.Parameters.AddWithValue("@tripId", tripId);

            var leaders = new List<Dictionary<string, object?>>();
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                leaders.Add(new Dictionary<string, object?>
                {
                    ["id"] = reader.GetInt32("employeeid"),
                    ["name"] = reader.IsDBNull(reader.GetOrdinal("email")) ? $"Employee #{reader.GetInt32("employeeid")}" : reader.GetString("email"),
                    ["role"] = reader.IsDBNull(reader.GetOrdinal("role")) ? null : reader.GetString("role"),
                    ["department"] = reader.IsDBNull(reader.GetOrdinal("department")) ? null : reader.GetString("department"),
                    ["availability"] = reader.IsDBNull(reader.GetOrdinal("availability")) ? null : reader.GetString("availability"),
                    ["email"] = reader.IsDBNull(reader.GetOrdinal("email")) ? null : reader.GetString("email"),
                    ["birthday"] = NormalizeCellForJson(reader.IsDBNull(reader.GetOrdinal("birthday")) ? null : reader.GetValue(reader.GetOrdinal("birthday")))
                });
            }

            return Ok(leaders);
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    [HttpGet("employees/{employeeId:int}")]
    public async Task<IActionResult> GetEmployeeProfile([FromRoute] int employeeId, CancellationToken cancellationToken)
    {
        if (employeeId <= 0)
            return BadRequest(new { error = "invalid_employee_id" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string sql = """
                SELECT employeeid, role, department, availability, email, birthday
                FROM employee
                WHERE employeeid = @id
                LIMIT 1;
                """;

            await using var command = new MySqlCommand(sql, connection);
            command.Parameters.AddWithValue("@id", employeeId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
                return NotFound(new { error = "employee_not_found" });

            var id = reader.GetInt32("employeeid");
            var email = reader.IsDBNull(reader.GetOrdinal("email")) ? null : reader.GetString("email");
            return Ok(new
            {
                id,
                name = string.IsNullOrWhiteSpace(email) ? $"Employee #{id}" : email,
                role = reader.IsDBNull(reader.GetOrdinal("role")) ? null : reader.GetString("role"),
                department = reader.IsDBNull(reader.GetOrdinal("department")) ? null : reader.GetString("department"),
                availability = reader.IsDBNull(reader.GetOrdinal("availability")) ? null : reader.GetString("availability"),
                email,
                birthday = NormalizeCellForJson(reader.IsDBNull(reader.GetOrdinal("birthday")) ? null : reader.GetValue(reader.GetOrdinal("birthday")))
            });
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    public sealed record LeadTripRequest(int EmployeeId);

    [HttpPost("trips/{tripId:int}/leaders")]
    public async Task<IActionResult> LeadTrip([FromRoute] int tripId, [FromBody] LeadTripRequest body, CancellationToken cancellationToken)
    {
        if (tripId <= 0 || body.EmployeeId <= 0)
            return BadRequest(new { error = "invalid_request" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string insertSql = """
                INSERT INTO supervises (employeeid, tripid)
                VALUES (@employeeId, @tripId)
                ON DUPLICATE KEY UPDATE employeeid = employeeid;
                """;

            await using (var cmd = new MySqlCommand(insertSql, connection))
            {
                cmd.Parameters.AddWithValue("@employeeId", body.EmployeeId);
                cmd.Parameters.AddWithValue("@tripId", tripId);
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }

            return Ok(new { employeeId = body.EmployeeId, tripId, status = "Leading" });
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    [HttpDelete("trips/{tripId:int}/leaders/{employeeId:int}")]
    public async Task<IActionResult> CancelLeadTrip([FromRoute] int tripId, [FromRoute] int employeeId, CancellationToken cancellationToken)
    {
        if (tripId <= 0 || employeeId <= 0)
            return BadRequest(new { error = "invalid_request" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string deleteSql = "DELETE FROM supervises WHERE employeeid = @employeeId AND tripid = @tripId;";

            await using var cmd = new MySqlCommand(deleteSql, connection);
            cmd.Parameters.AddWithValue("@employeeId", employeeId);
            cmd.Parameters.AddWithValue("@tripId", tripId);
            await cmd.ExecuteNonQueryAsync(cancellationToken);

            return Ok(new { employeeId, tripId, status = "Cancelled" });
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    [HttpGet("employees/{employeeId:int}/guided-trips")]
    public async Task<IActionResult> GetGuidedTrips([FromRoute] int employeeId, CancellationToken cancellationToken)
    {
        if (employeeId <= 0)
            return BadRequest(new { error = "invalid_employee_id" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string sql = """
                SELECT h.tripid,
                       h.tripname,
                       h.location,
                       h.difficultylevel,
                       h.price,
                       h.distance,
                       h.date,
                       h.category,
                       h.numberofhikers,
                       h.`time`
                FROM supervises s
                JOIN hikingtrip h ON h.tripid = s.tripid
                WHERE s.employeeid = @employeeId
                ORDER BY h.date, h.tripid;
                """;

            await using var cmd = new MySqlCommand(sql, connection);
            cmd.Parameters.AddWithValue("@employeeId", employeeId);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

            var rows = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new Dictionary<string, object?>
                {
                    ["id"] = reader.GetInt32("tripid"),
                    ["name"] = reader.IsDBNull(reader.GetOrdinal("tripname")) ? null : reader.GetString("tripname"),
                    ["location"] = reader.IsDBNull(reader.GetOrdinal("location")) ? null : reader.GetString("location"),
                    ["difficulty"] = reader.IsDBNull(reader.GetOrdinal("difficultylevel")) ? null : reader.GetString("difficultylevel"),
                    ["price"] = reader.IsDBNull(reader.GetOrdinal("price")) ? null : reader.GetValue(reader.GetOrdinal("price")),
                    ["distance"] = reader.IsDBNull(reader.GetOrdinal("distance")) ? null : reader.GetValue(reader.GetOrdinal("distance")),
                    ["date"] = reader.IsDBNull(reader.GetOrdinal("date")) ? null : NormalizeCellForJson(reader.GetValue(reader.GetOrdinal("date"))),
                    ["category"] = reader.IsDBNull(reader.GetOrdinal("category")) ? null : reader.GetString("category"),
                    ["hikers"] = reader.IsDBNull(reader.GetOrdinal("numberofhikers")) ? null : reader.GetValue(reader.GetOrdinal("numberofhikers")),
                    ["time"] = reader.IsDBNull(reader.GetOrdinal("time")) ? null : NormalizeCellForJson(reader.GetValue(reader.GetOrdinal("time")))
                });
            }

            return Ok(rows);
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    [HttpGet("employees/{employeeId:int}/guided-customers")]
    public async Task<IActionResult> GetGuidedCustomers([FromRoute] int employeeId, CancellationToken cancellationToken)
    {
        if (employeeId <= 0)
            return BadRequest(new { error = "invalid_employee_id" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string sql = """
                SELECT DISTINCT c.customerid,
                                c.fname,
                                c.lname,
                                c.email,
                                r.tripid,
                                h.tripname
                FROM supervises s
                JOIN reservation r ON r.tripid = s.tripid
                JOIN customer c ON c.customerid = r.customerid
                JOIN hikingtrip h ON h.tripid = r.tripid
                WHERE s.employeeid = @employeeId
                  AND LOWER(TRIM(COALESCE(r.resstatus, ''))) <> 'cancelled'
                  AND LOWER(TRIM(COALESCE(r.resstatus, ''))) <> 'canceled'
                ORDER BY h.tripname, c.lname, c.fname;
                """;

            await using var cmd = new MySqlCommand(sql, connection);
            cmd.Parameters.AddWithValue("@employeeId", employeeId);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

            var rows = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetInt32("customerid");
                var fname = reader.IsDBNull(reader.GetOrdinal("fname")) ? "" : reader.GetString("fname");
                var lname = reader.IsDBNull(reader.GetOrdinal("lname")) ? "" : reader.GetString("lname");
                var name = string.Join(' ', new[] { fname, lname }.Where(x => !string.IsNullOrWhiteSpace(x))).Trim();
                rows.Add(new Dictionary<string, object?>
                {
                    ["id"] = cid,
                    ["name"] = string.IsNullOrWhiteSpace(name) ? $"Customer #{cid}" : name,
                    ["email"] = reader.IsDBNull(reader.GetOrdinal("email")) ? null : reader.GetString("email"),
                    ["tripId"] = reader.IsDBNull(reader.GetOrdinal("tripid")) ? null : reader.GetValue(reader.GetOrdinal("tripid")),
                    ["trip"] = reader.IsDBNull(reader.GetOrdinal("tripname")) ? null : reader.GetString("tripname")
                });
            }

            return Ok(rows);
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

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
    public async Task<IActionResult> GetCustomers(CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var customerTable = await FindTableNameAsync(
                connection,
                ["customer", "customers", "clients", "client"],
                cancellationToken);
            if (customerTable is null)
                return Ok(new List<Dictionary<string, object?>>());

            var columns = await GetColumnsAsync(connection, customerTable, cancellationToken);
            var available = new HashSet<string>(columns, StringComparer.OrdinalIgnoreCase);

            var phoneTable = await FindTableNameAsync(connection, ["customerphone"], cancellationToken);

            var selectParts = new List<string>
            {
                BuildSelectPart("id", ["customerid", "id", "customer_id", "client_id"], available),
                BuildSelectPart("fname", ["fname", "first_name", "firstname"], available),
                BuildSelectPart("lname", ["lname", "last_name", "lastname"], available),
                BuildSelectPart("email", ["email", "email_address"], available),
                BuildSelectPart("birthday", ["birthday", "dob"], available),
                BuildSelectPart(
                    "registrationdate",
                    ["registrationdate", "registration_date", "created_at"],
                    available)
            };

            var idCol = new[] { "customerid", "id", "customer_id", "client_id" }.FirstOrDefault(available.Contains);
            var phoneColOnCustomer = new[] { "phone", "phonenumber", "phone_number", "mobile", "cell", "primary_phone" }
                .FirstOrDefault(available.Contains);

            if (phoneColOnCustomer is not null)
                selectParts.Add($"{Backtick(phoneColOnCustomer)} AS `phone`");
            else if (phoneTable is not null && idCol is not null)
            {
                var phoneCols = await GetColumnsAsync(connection, phoneTable, cancellationToken);
                var phoneAvail = new HashSet<string>(phoneCols, StringComparer.OrdinalIgnoreCase);
                var pn = new[] { "phonenumber", "phone_number", "phone", "mobile" }.FirstOrDefault(phoneAvail.Contains);
                var fk = new[] { "customerid", "customer_id" }.FirstOrDefault(phoneAvail.Contains);
                if (pn is not null && fk is not null)
                {
                    selectParts.Add(
                        $"(SELECT GROUP_CONCAT({Backtick(pn)} ORDER BY {Backtick(pn)} SEPARATOR ', ') FROM {Backtick(phoneTable)} cp WHERE cp.{Backtick(fk)} = {Backtick(customerTable)}.{Backtick(idCol)}) AS `phone`");
                }
                else
                    selectParts.Add("NULL AS `phone`");
            }
            else
                selectParts.Add("NULL AS `phone`");

            selectParts.Add(BuildSelectPart("city", ["city", "home_city", "town"], available));

            var sql = $"SELECT {string.Join(", ", selectParts)} FROM {Backtick(customerTable)} LIMIT {MaxListRows};";
            await using var command = new MySqlCommand(sql, connection);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            var rows = new List<Dictionary<string, object?>>();
            while (await reader.ReadAsync(cancellationToken))
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    var value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                    row[reader.GetName(i)] = NormalizeCellForJson(value);
                }

                rows.Add(row);
            }

            return Ok(rows);
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

    [HttpGet("employees")]
    public Task<IActionResult> GetEmployees(CancellationToken cancellationToken) =>
        QueryListOrDatabaseUnavailableAsync(
            ["employee", "employees", "staff"],
            new Dictionary<string, string[]>
            {
                ["id"] = ["employeeid", "id", "employee_id", "staff_id"],
                ["fname"] = ["fname", "first_name", "firstname"],
                ["lname"] = ["lname", "last_name", "lastname"],
                ["role"] = ["role", "job_title", "position"],
                ["department"] = ["department", "team", "division"],
                ["salary"] = ["salary"],
                ["availability"] = ["availability"],
                ["email"] = ["email", "email_address"],
                ["birthday"] = ["birthday", "dob"],
                ["bonus"] = ["bonus"]
            },
            cancellationToken);

    /// <summary>
    /// Admin analytics: aggregates from <c>reservation</c>, <c>hikingtrip</c>, and <c>customer</c>.
    /// Booking value = trip price × party size; excludes cancelled reservations.
    /// </summary>
    [HttpGet("reports")]
    public async Task<IActionResult> GetReports(CancellationToken cancellationToken)
    {
        const string notCancelled = """
            LOWER(TRIM(COALESCE(r.resstatus, ''))) NOT IN ('cancelled', 'canceled')
            """;

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var monthlyRevenue = new List<Dictionary<string, object?>>();
            const string monthlySql = $"""
                SELECT DATE_FORMAT(COALESCE(r.reservationdate, h.date), '%Y-%m') AS monthKey,
                       SUM(h.price * r.numberofhikers) AS revenue
                FROM reservation r
                INNER JOIN hikingtrip h ON h.tripid = r.tripid
                WHERE {notCancelled}
                GROUP BY DATE_FORMAT(COALESCE(r.reservationdate, h.date), '%Y-%m')
                ORDER BY monthKey ASC
                LIMIT 36;
                """;
            await using (var cmd = new MySqlCommand(monthlySql, connection))
            await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    monthlyRevenue.Add(new Dictionary<string, object?>
                    {
                        ["month"] = reader.IsDBNull(reader.GetOrdinal("monthKey")) ? null : reader.GetString("monthKey"),
                        ["revenue"] = reader.IsDBNull(reader.GetOrdinal("revenue")) ? 0m : reader.GetDecimal("revenue")
                    });
                }
            }

            var topCustomers = new List<Dictionary<string, object?>>();
            const string customersSql = $"""
                SELECT c.customerid AS customerId,
                       c.fname,
                       c.lname,
                       SUM(h.price * r.numberofhikers) AS totalSpend,
                       COUNT(*) AS reservationCount
                FROM reservation r
                INNER JOIN hikingtrip h ON h.tripid = r.tripid
                INNER JOIN customer c ON c.customerid = r.customerid
                WHERE {notCancelled}
                GROUP BY c.customerid, c.fname, c.lname
                ORDER BY totalSpend DESC
                LIMIT 15;
                """;
            await using (var cmd = new MySqlCommand(customersSql, connection))
            await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    var cid = reader.GetInt32("customerId");
                    var fn = reader.IsDBNull(reader.GetOrdinal("fname")) ? "" : reader.GetString("fname");
                    var ln = reader.IsDBNull(reader.GetOrdinal("lname")) ? "" : reader.GetString("lname");
                    var nm = string.Join(' ', new[] { fn, ln }.Where(s => !string.IsNullOrWhiteSpace(s))).Trim();
                    topCustomers.Add(new Dictionary<string, object?>
                    {
                        ["customerId"] = cid,
                        ["name"] = string.IsNullOrWhiteSpace(nm) ? $"Customer #{cid}" : nm,
                        ["totalSpend"] = reader.IsDBNull(reader.GetOrdinal("totalSpend")) ? 0m : reader.GetDecimal("totalSpend"),
                        ["reservationCount"] = reader.IsDBNull(reader.GetOrdinal("reservationCount"))
                            ? 0
                            : Convert.ToInt32(reader.GetInt64("reservationCount"))
                    });
                }
            }

            var categoryRevenue = new List<Dictionary<string, object?>>();
            const string categorySql = $"""
                SELECT COALESCE(NULLIF(TRIM(h.category), ''), '(Uncategorized)') AS category,
                       SUM(h.price * r.numberofhikers) AS revenue
                FROM reservation r
                INNER JOIN hikingtrip h ON h.tripid = r.tripid
                WHERE {notCancelled}
                GROUP BY COALESCE(NULLIF(TRIM(h.category), ''), '(Uncategorized)')
                ORDER BY revenue DESC;
                """;
            await using (var cmd = new MySqlCommand(categorySql, connection))
            await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    categoryRevenue.Add(new Dictionary<string, object?>
                    {
                        ["category"] = reader.GetString("category"),
                        ["revenue"] = reader.IsDBNull(reader.GetOrdinal("revenue")) ? 0m : reader.GetDecimal("revenue")
                    });
                }
            }

            var tripsByDifficulty = new List<Dictionary<string, object?>>();
            const string difficultySql = """
                SELECT COALESCE(NULLIF(TRIM(h.difficultylevel), ''), '(Unknown)') AS difficulty,
                       COUNT(DISTINCT h.tripid) AS tripCount,
                       COALESCE(SUM(CASE
                           WHEN LOWER(TRIM(COALESCE(r.resstatus, ''))) NOT IN ('cancelled', 'canceled')
                           THEN r.numberofhikers
                           ELSE 0
                       END), 0) AS bookedSeats
                FROM hikingtrip h
                LEFT JOIN reservation r ON r.tripid = h.tripid
                GROUP BY COALESCE(NULLIF(TRIM(h.difficultylevel), ''), '(Unknown)')
                ORDER BY tripCount DESC, difficulty ASC;
                """;
            await using (var cmd = new MySqlCommand(difficultySql, connection))
            await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    tripsByDifficulty.Add(new Dictionary<string, object?>
                    {
                        ["difficulty"] = reader.GetString("difficulty"),
                        ["tripCount"] = reader.GetInt32("tripCount"),
                        ["bookedSeats"] = reader.IsDBNull(reader.GetOrdinal("bookedSeats"))
                            ? 0m
                            : Convert.ToDecimal(reader.GetValue(reader.GetOrdinal("bookedSeats")))
                    });
                }
            }

            var reservationStatus = new List<Dictionary<string, object?>>();
            const string statusSql = """
                SELECT COALESCE(NULLIF(TRIM(resstatus), ''), '(Unknown)') AS status,
                       COUNT(*) AS reservationCount
                FROM reservation
                GROUP BY COALESCE(NULLIF(TRIM(resstatus), ''), '(Unknown)')
                ORDER BY reservationCount DESC;
                """;
            await using (var cmd = new MySqlCommand(statusSql, connection))
            await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    var cntOrd = reader.GetOrdinal("reservationCount");
                    var cntLong = reader.IsDBNull(cntOrd) ? 0L : Convert.ToInt64(reader.GetValue(cntOrd), CultureInfo.InvariantCulture);
                    reservationStatus.Add(new Dictionary<string, object?>
                    {
                        ["status"] = reader.GetString("status"),
                        ["count"] = cntLong > int.MaxValue ? int.MaxValue : (int)cntLong
                    });
                }
            }

            return Ok(new
            {
                monthlyRevenue,
                topCustomers,
                categoryRevenue,
                tripsByDifficulty,
                reservationStatus
            });
        }
        catch (MySqlException ex)
        {
            return DatabaseUnavailable(ex);
        }
    }

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

    public sealed record BookRequest(int TripId, int CustomerId, int NumberOfHikers);

    /// <summary>
    /// Creates a reservation for a trip. Assigns an employee from <c>supervises</c> when possible, otherwise the first employee row.
    /// </summary>
    [HttpPost("book")]
    public async Task<IActionResult> Book([FromBody] BookRequest body, CancellationToken cancellationToken)
    {
        if (body.TripId <= 0 || body.CustomerId <= 0 || body.NumberOfHikers <= 0)
            return BadRequest(new { error = "invalid_request", message = "tripId, customerId, and numberOfHikers must be positive." });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string tripSql = """
                SELECT tripid
                FROM hikingtrip
                WHERE tripid = @tripId
                LIMIT 1;
                """;

            await using (var tripCmd = new MySqlCommand(tripSql, connection))
            {
                tripCmd.Parameters.AddWithValue("@tripId", body.TripId);
                var exists = await tripCmd.ExecuteScalarAsync(cancellationToken);
                if (exists is null)
                    return NotFound(new { error = "trip_not_found" });
            }

            const string customerSql = """
                SELECT customerid
                FROM customer
                WHERE customerid = @customerId
                LIMIT 1;
                """;

            await using (var custCmd = new MySqlCommand(customerSql, connection))
            {
                custCmd.Parameters.AddWithValue("@customerId", body.CustomerId);
                var exists = await custCmd.ExecuteScalarAsync(cancellationToken);
                if (exists is null)
                    return BadRequest(new { error = "customer_not_found" });
            }

            var employeeId = await ResolveEmployeeIdForBookingAsync(connection, body.TripId, cancellationToken);
            if (employeeId is null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "no_employee",
                    message = "No employee is available to assign (add rows to employee / supervises)."
                });

            const string insertSql = """
                INSERT INTO reservation                    (reservationdate, numberofhikers, resstatus, reservationtime, customerid, tripid, employeeid)
                VALUES
                    (CURDATE(), @num, 'Pending', COALESCE((SELECT `time` FROM hikingtrip WHERE tripid = @tripId LIMIT 1), CURTIME()), @customerId, @tripId, @employeeId);
                """;

            await using var insertCmd = new MySqlCommand(insertSql, connection);
            insertCmd.Parameters.AddWithValue("@num", body.NumberOfHikers);
            insertCmd.Parameters.AddWithValue("@customerId", body.CustomerId);
            insertCmd.Parameters.AddWithValue("@tripId", body.TripId);
            insertCmd.Parameters.AddWithValue("@employeeId", employeeId.Value);

            await insertCmd.ExecuteNonQueryAsync(cancellationToken);
            var newId = (int)insertCmd.LastInsertedId;

            return Ok(new { reservationId = newId, status = "Pending" });
        }
        catch (MySqlException ex)
        {
            var detail = _environment.IsDevelopment() ? ex.Message : "Database error while booking.";
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "database_error", message = detail });
        }
    }

    public sealed record ConfirmReservationRequest(int ReservationId, int CustomerId);
    public sealed record CancelReservationRequest(int ReservationId, int CustomerId);

    /// <summary>
    /// Marks a pending reservation as confirmed after payment (demo — no real processor).
    /// </summary>
    [HttpPatch("reservations/confirm")]
    public async Task<IActionResult> ConfirmReservation([FromBody] ConfirmReservationRequest body, CancellationToken cancellationToken)
    {
        if (body.ReservationId <= 0 || body.CustomerId <= 0)
            return BadRequest(new { error = "invalid_request", message = "reservationId and customerId must be positive." });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string selectSql = """
                SELECT resstatus
                FROM reservation
                WHERE reservationid = @rid
                  AND customerid = @customerId
                LIMIT 1;
                """;

            string? status = null;
            await using (var sel = new MySqlCommand(selectSql, connection))
            {
                sel.Parameters.AddWithValue("@rid", body.ReservationId);
                sel.Parameters.AddWithValue("@customerId", body.CustomerId);
                var v = await sel.ExecuteScalarAsync(cancellationToken);
                if (v is null || v is DBNull)
                    return NotFound(new { error = "reservation_not_found" });

                status = Convert.ToString(v);
            }

            var st = status?.Trim().ToLowerInvariant();
            if (st == "confirmed")
                return Ok(new { reservationId = body.ReservationId, status = "Confirmed", alreadyConfirmed = true });

            if (st != "pending")
            {
                return Conflict(new
                {
                    error = "invalid_status",
                    message = $"Cannot confirm reservation with status '{status}'."
                });
            }

            const string updateSql = """
                UPDATE reservation
                SET resstatus = 'Confirmed'
                WHERE reservationid = @rid
                  AND customerid = @customerId
                  AND LOWER(TRIM(resstatus)) = 'pending';
                """;

            await using (var upd = new MySqlCommand(updateSql, connection))
            {
                upd.Parameters.AddWithValue("@rid", body.ReservationId);
                upd.Parameters.AddWithValue("@customerId", body.CustomerId);
                var n = await upd.ExecuteNonQueryAsync(cancellationToken);
                if (n == 0)
                    return Conflict(new { error = "concurrent_update", message = "Reservation could not be updated." });
            }

            return Ok(new { reservationId = body.ReservationId, status = "Confirmed" });
        }
        catch (MySqlException ex)
        {
            var detail = _environment.IsDevelopment() ? ex.Message : "Database error while confirming reservation.";
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "database_error", message = detail });
        }
    }

    /// <summary>
    /// Cancels a reservation (keeps the row for admin reporting; hikers won't see cancelled rows).
    /// </summary>
    [HttpPatch("reservations/cancel")]
    public async Task<IActionResult> CancelReservation([FromBody] CancelReservationRequest body, CancellationToken cancellationToken)
    {
        if (body.ReservationId <= 0 || body.CustomerId <= 0)
            return BadRequest(new { error = "invalid_request", message = "reservationId and customerId must be positive." });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            const string selectSql = """
                SELECT resstatus
                FROM reservation
                WHERE reservationid = @rid
                  AND customerid = @customerId
                LIMIT 1;
                """;

            string? status = null;
            await using (var sel = new MySqlCommand(selectSql, connection))
            {
                sel.Parameters.AddWithValue("@rid", body.ReservationId);
                sel.Parameters.AddWithValue("@customerId", body.CustomerId);
                var v = await sel.ExecuteScalarAsync(cancellationToken);
                if (v is null || v is DBNull)
                    return NotFound(new { error = "reservation_not_found" });

                status = Convert.ToString(v);
            }

            var st = status?.Trim().ToLowerInvariant();
            if (st is "cancelled" or "canceled")
                return Ok(new { reservationId = body.ReservationId, status = "Cancelled", alreadyCancelled = true });

            const string updateSql = """
                UPDATE reservation
                SET resstatus = 'Cancelled'
                WHERE reservationid = @rid
                  AND customerid = @customerId
                  AND LOWER(TRIM(resstatus)) <> 'cancelled'
                  AND LOWER(TRIM(resstatus)) <> 'canceled';
                """;

            await using (var upd = new MySqlCommand(updateSql, connection))
            {
                upd.Parameters.AddWithValue("@rid", body.ReservationId);
                upd.Parameters.AddWithValue("@customerId", body.CustomerId);
                var n = await upd.ExecuteNonQueryAsync(cancellationToken);
                if (n == 0)
                    return Conflict(new { error = "concurrent_update", message = "Reservation could not be updated." });
            }

            return Ok(new { reservationId = body.ReservationId, status = "Cancelled" });
        }
        catch (MySqlException ex)
        {
            var detail = _environment.IsDevelopment() ? ex.Message : "Database error while cancelling reservation.";
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "database_error", message = detail });
        }
    }

    private static async Task<int?> ResolveEmployeeIdForBookingAsync(
        MySqlConnection connection,
        int tripId,
        CancellationToken cancellationToken)
    {
        const string supervisedSql = """
            SELECT s.employeeid
            FROM supervises s
            WHERE s.tripid = @tripId
            LIMIT 1;
            """;

        await using (var cmd = new MySqlCommand(supervisedSql, connection))
        {
            cmd.Parameters.AddWithValue("@tripId", tripId);
            var v = await cmd.ExecuteScalarAsync(cancellationToken);
            if (v is not null && v is not DBNull)
                return Convert.ToInt32(v);
        }

        const string anySql = """
            SELECT employeeid
            FROM employee
            ORDER BY employeeid ASC
            LIMIT 1;
            """;

        await using var anyCmd = new MySqlCommand(anySql, connection);
        var any = await anyCmd.ExecuteScalarAsync(cancellationToken);
        if (any is null || any is DBNull)
            return null;

        return Convert.ToInt32(any);
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
                row[reader.GetName(i)] = NormalizeCellForJson(value);
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

        return $"{Backtick(match)} AS `{outputName}`";
    }

    private static string Backtick(string ident) =>
        "`" + ident.Replace("`", "``", StringComparison.Ordinal) + "`";

    /// <summary>
    /// <see cref="Dictionary{TKey,TValue}"/> with <c>object?</c> values serializes <see cref="DateTime"/> as a JSON
    /// object graph, which becomes <c>[object Object]</c> in the SPA. Emit ISO-style strings instead.
    /// </summary>
    private static object? NormalizeCellForJson(object? value)
    {
        if (value is null or DBNull)
            return null;

        return value switch
        {
            DateTime dt => dt.TimeOfDay == TimeSpan.Zero
                ? dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                : dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            TimeSpan t => t.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
            _ => value
        };
    }
}

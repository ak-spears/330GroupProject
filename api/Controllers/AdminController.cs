using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using TrailBuddy.Api.Data;

namespace TrailBuddy.Api.Controllers;

/// <summary>
/// Mutations restricted to database users whose <c>employee.role</c> is <c>admin</c>.
/// Client sends <c>X-TrailBuddy-Admin-Id</c> matching the logged-in admin's employee id.
/// </summary>
[ApiController]
[Route("api/admin")]
public sealed class AdminController : ControllerBase
{
    private readonly MySqlConnectionFactory _connectionFactory;
    private readonly IWebHostEnvironment _environment;

    public AdminController(MySqlConnectionFactory connectionFactory, IWebHostEnvironment environment)
    {
        _connectionFactory = connectionFactory;
        _environment = environment;
    }

    private bool TryReadAdminEmployeeId(out int adminId)
    {
        adminId = 0;
        if (!Request.Headers.TryGetValue("X-TrailBuddy-Admin-Id", out var vals))
            return false;
        var raw = vals.FirstOrDefault()?.Trim();
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out adminId) && adminId > 0;
    }

    private async Task<IActionResult?> RequireAdminAsync(MySqlConnection connection, CancellationToken cancellationToken)
    {
        if (!TryReadAdminEmployeeId(out var adminId))
            return Unauthorized(new { error = "admin_auth", message = "Missing or invalid X-TrailBuddy-Admin-Id header." });

        const string sql = """
            SELECT LOWER(TRIM(COALESCE(role, '')))
            FROM employee
            WHERE employeeid = @id
            LIMIT 1;
            """;

        await using var cmd = new MySqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@id", adminId);
        var v = await cmd.ExecuteScalarAsync(cancellationToken);
        var role = Convert.ToString(v)?.Trim().ToLowerInvariant();
        if (role != "admin")
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "forbidden", message = "Admin privileges required." });

        return null;
    }

    public sealed record TripWriteBody(
        string TripName,
        string Location,
        string Distance,
        string Date,
        decimal Price,
        int NumberOfHikers,
        string DifficultyLevel,
        string Category,
        string Time);

    [HttpPatch("trips/{tripId:int}")]
    public async Task<IActionResult> UpdateTrip([FromRoute] int tripId, [FromBody] TripWriteBody body, CancellationToken cancellationToken)
    {
        if (tripId <= 0)
            return BadRequest(new { error = "invalid_trip_id" });

        var validation = ValidateTripBody(body, out var tripDate, out var distance, out var tripTime);
        if (validation is not null)
            return validation;

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var auth = await RequireAdminAsync(connection, cancellationToken);
            if (auth is not null)
                return auth;

            const string updateSql = """
                UPDATE hikingtrip
                SET tripname = @name,
                    location = @location,
                    distance = @distance,
                    date = @date,
                    price = @price,
                    numberofhikers = @hikers,
                    difficultylevel = @difficulty,
                    category = @category,
                    `time` = @time
                WHERE tripid = @tripId;
                """;

            await using var upd = new MySqlCommand(updateSql, connection);
            upd.Parameters.AddWithValue("@name", body.TripName.Trim());
            upd.Parameters.AddWithValue("@location", body.Location.Trim());
            upd.Parameters.AddWithValue("@distance", distance);
            upd.Parameters.AddWithValue("@date", tripDate.ToDateTime(TimeOnly.MinValue));
            upd.Parameters.AddWithValue("@price", body.Price);
            upd.Parameters.AddWithValue("@hikers", body.NumberOfHikers);
            upd.Parameters.AddWithValue("@difficulty", body.DifficultyLevel.Trim());
            upd.Parameters.AddWithValue("@category", body.Category.Trim());
            upd.Parameters.AddWithValue("@time", tripTime.ToTimeSpan());
            upd.Parameters.AddWithValue("@tripId", tripId);

            var n = await upd.ExecuteNonQueryAsync(cancellationToken);
            if (n == 0)
                return NotFound(new { error = "trip_not_found" });

            return Ok(new { id = tripId });
        }
        catch (MySqlException ex)
        {
            return DatabaseError(ex);
        }
    }

    [HttpDelete("trips/{tripId:int}")]
    public async Task<IActionResult> DeleteTrip([FromRoute] int tripId, CancellationToken cancellationToken)
    {
        if (tripId <= 0)
            return BadRequest(new { error = "invalid_trip_id" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var auth = await RequireAdminAsync(connection, cancellationToken);
            if (auth is not null)
                return auth;

            await using var tx = await connection.BeginTransactionAsync(cancellationToken);

            const string delRes = "DELETE FROM reservation WHERE tripid = @tripId;";
            await using (var c1 = new MySqlCommand(delRes, connection, tx))
            {
                c1.Parameters.AddWithValue("@tripId", tripId);
                await c1.ExecuteNonQueryAsync(cancellationToken);
            }

            const string delSup = "DELETE FROM supervises WHERE tripid = @tripId;";
            await using (var c2 = new MySqlCommand(delSup, connection, tx))
            {
                c2.Parameters.AddWithValue("@tripId", tripId);
                await c2.ExecuteNonQueryAsync(cancellationToken);
            }

            const string delTrip = "DELETE FROM hikingtrip WHERE tripid = @tripId;";
            await using (var c3 = new MySqlCommand(delTrip, connection, tx))
            {
                c3.Parameters.AddWithValue("@tripId", tripId);
                var n = await c3.ExecuteNonQueryAsync(cancellationToken);
                if (n == 0)
                {
                    await tx.RollbackAsync(cancellationToken);
                    return NotFound(new { error = "trip_not_found" });
                }
            }

            await tx.CommitAsync(cancellationToken);
            return Ok(new { id = tripId, deleted = true });
        }
        catch (MySqlException ex)
        {
            return DatabaseError(ex);
        }
    }

    public sealed record CreateCustomerBody(string Fname, string Lname, string Email, string Password, string Birthday);

    [HttpPost("customers")]
    public async Task<IActionResult> CreateCustomer([FromBody] CreateCustomerBody body, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(body.Fname)
            || string.IsNullOrWhiteSpace(body.Lname)
            || string.IsNullOrWhiteSpace(body.Email)
            || string.IsNullOrWhiteSpace(body.Password)
            || string.IsNullOrWhiteSpace(body.Birthday))
        {
            return BadRequest(new { error = "missing_fields", message = "First name, last name, email, password, and birthday are required." });
        }

        if (!DateOnly.TryParse(body.Birthday.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var birthDate))
            return BadRequest(new { error = "invalid_birthday" });

        var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
        if (birthDate > today)
            return BadRequest(new { error = "invalid_birthday", message = "Date of birth cannot be in the future." });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var auth = await RequireAdminAsync(connection, cancellationToken);
            if (auth is not null)
                return auth;

            const string sql = """
                INSERT INTO customer (fname, lname, email, password, birthday, registrationdate)
                VALUES (@fname, @lname, @email, @password, @birthday, CURDATE());
                """;

            await using var cmd = new MySqlCommand(sql, connection);
            cmd.Parameters.AddWithValue("@fname", body.Fname.Trim());
            cmd.Parameters.AddWithValue("@lname", body.Lname.Trim());
            cmd.Parameters.AddWithValue("@email", body.Email.Trim().ToLowerInvariant());
            cmd.Parameters.AddWithValue("@password", BCrypt.Net.BCrypt.HashPassword(body.Password));
            cmd.Parameters.AddWithValue("@birthday", birthDate.ToDateTime(TimeOnly.MinValue));

            await cmd.ExecuteNonQueryAsync(cancellationToken);
            var id = (int)cmd.LastInsertedId;
            return Ok(new { id });
        }
        catch (MySqlException ex) when (ex.Number == 1062)
        {
            return Conflict(new { error = "email_already_exists" });
        }
        catch (MySqlException ex)
        {
            return DatabaseError(ex);
        }
    }

    public sealed record PatchCustomerBody(string Fname, string Lname, string Email, string Birthday, string? Password);

    [HttpPatch("customers/{customerId:int}")]
    public async Task<IActionResult> PatchCustomer([FromRoute] int customerId, [FromBody] PatchCustomerBody body, CancellationToken cancellationToken)
    {
        if (customerId <= 0)
            return BadRequest(new { error = "invalid_customer_id" });

        if (string.IsNullOrWhiteSpace(body.Fname)
            || string.IsNullOrWhiteSpace(body.Lname)
            || string.IsNullOrWhiteSpace(body.Email)
            || string.IsNullOrWhiteSpace(body.Birthday))
        {
            return BadRequest(new { error = "missing_fields" });
        }

        if (!DateOnly.TryParse(body.Birthday.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var birthDate))
            return BadRequest(new { error = "invalid_birthday" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var auth = await RequireAdminAsync(connection, cancellationToken);
            if (auth is not null)
                return auth;

            const string dupSql = """
                SELECT COUNT(*) FROM customer
                WHERE LOWER(email) = LOWER(@email) AND customerid <> @id;
                """;
            await using (var dup = new MySqlCommand(dupSql, connection))
            {
                dup.Parameters.AddWithValue("@email", body.Email.Trim());
                dup.Parameters.AddWithValue("@id", customerId);
                var count = Convert.ToInt32(await dup.ExecuteScalarAsync(cancellationToken));
                if (count > 0)
                    return Conflict(new { error = "email_in_use" });
            }

            var hasPassword = !string.IsNullOrWhiteSpace(body.Password);
            var updateSql = hasPassword
                ? """
                  UPDATE customer
                  SET fname = @fname, lname = @lname, email = @email, birthday = @birthday, password = @password
                  WHERE customerid = @id;
                  """
                : """
                  UPDATE customer
                  SET fname = @fname, lname = @lname, email = @email, birthday = @birthday
                  WHERE customerid = @id;
                  """;

            await using var upd = new MySqlCommand(updateSql, connection);
            upd.Parameters.AddWithValue("@fname", body.Fname.Trim());
            upd.Parameters.AddWithValue("@lname", body.Lname.Trim());
            upd.Parameters.AddWithValue("@email", body.Email.Trim().ToLowerInvariant());
            upd.Parameters.AddWithValue("@birthday", birthDate.ToDateTime(TimeOnly.MinValue));
            upd.Parameters.AddWithValue("@id", customerId);
            if (hasPassword)
                upd.Parameters.AddWithValue("@password", BCrypt.Net.BCrypt.HashPassword(body.Password!));

            var n = await upd.ExecuteNonQueryAsync(cancellationToken);
            if (n == 0)
                return NotFound(new { error = "not_found" });

            return Ok(new { id = customerId });
        }
        catch (MySqlException ex)
        {
            return DatabaseError(ex);
        }
    }

    [HttpDelete("customers/{customerId:int}")]
    public async Task<IActionResult> DeleteCustomer([FromRoute] int customerId, CancellationToken cancellationToken)
    {
        if (customerId <= 0)
            return BadRequest(new { error = "invalid_customer_id" });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            var auth = await RequireAdminAsync(connection, cancellationToken);
            if (auth is not null)
                return auth;

            await using var tx = await connection.BeginTransactionAsync(cancellationToken);

            const string delPhones = """
                DELETE FROM customerphone
                WHERE customerid = @id;
                """;
            await using (var c0 = new MySqlCommand(delPhones, connection, tx))
            {
                c0.Parameters.AddWithValue("@id", customerId);
                try
                {
                    await c0.ExecuteNonQueryAsync(cancellationToken);
                }
                catch (MySqlException ex) when (ex.Number == 1146)
                {
                    /* customerphone table may not exist in minimal schemas */
                }
            }

            const string delRes = "DELETE FROM reservation WHERE customerid = @id;";
            await using (var c1 = new MySqlCommand(delRes, connection, tx))
            {
                c1.Parameters.AddWithValue("@id", customerId);
                await c1.ExecuteNonQueryAsync(cancellationToken);
            }

            const string delCust = "DELETE FROM customer WHERE customerid = @id;";
            await using (var c2 = new MySqlCommand(delCust, connection, tx))
            {
                c2.Parameters.AddWithValue("@id", customerId);
                var n = await c2.ExecuteNonQueryAsync(cancellationToken);
                if (n == 0)
                {
                    await tx.RollbackAsync(cancellationToken);
                    return NotFound(new { error = "not_found" });
                }
            }

            await tx.CommitAsync(cancellationToken);
            return Ok(new { id = customerId, deleted = true });
        }
        catch (MySqlException ex)
        {
            return DatabaseError(ex);
        }
    }

    private IActionResult? ValidateTripBody(
        TripWriteBody body,
        out DateOnly tripDate,
        out decimal distance,
        out TimeOnly tripTime)
    {
        tripDate = default;
        distance = 0;
        tripTime = default;

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
                message = "Trip fields invalid or incomplete."
            });
        }

        if (!DateOnly.TryParse(body.Date.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out tripDate))
            return BadRequest(new { error = "invalid_date" });

        if (!decimal.TryParse(body.Distance.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out distance)
            || distance < 0)
        {
            return BadRequest(new { error = "invalid_distance" });
        }

        if (!TimeOnly.TryParse(body.Time.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out tripTime))
            return BadRequest(new { error = "invalid_time" });

        return null;
    }

    private ObjectResult DatabaseError(MySqlException ex)
    {
        var detail = _environment.IsDevelopment() ? ex.Message : "Database error.";
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "database_error", message = detail });
    }
}

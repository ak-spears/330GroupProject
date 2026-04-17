using System.Globalization;
using BCrypt.Net;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using TrailBuddy.Api.Data;

namespace TrailBuddy.Api.Controllers;

[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    private readonly MySqlConnectionFactory _connectionFactory;

    public AuthController(MySqlConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            return Unauthorized(new { error = "invalid_credentials" });

        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);

        var requestedRole = string.IsNullOrWhiteSpace(request.Role)
            ? null
            : request.Role.Trim().ToLowerInvariant();

        if (requestedRole is not null && requestedRole is not ("hiker" or "employee" or "admin"))
            return Unauthorized(new { error = "invalid_credentials" });

        if (requestedRole is null or "hiker")
        {
            var customerUser = await FindCustomerAsync(connection, request.Email, cancellationToken);
            if (customerUser is not null && VerifyPassword(request.Password, customerUser.PasswordHash))
            {
                return Ok(new
                {
                    role = "hiker",
                    id = customerUser.Id,
                    name = customerUser.Name
                });
            }

            if (requestedRole == "hiker")
                return Unauthorized(new { error = "invalid_credentials" });
        }

        if (requestedRole is null or "employee" or "admin")
        {
            var employeeUser = await FindEmployeeAsync(connection, request.Email, cancellationToken);
            if (employeeUser is not null && VerifyPassword(request.Password, employeeUser.PasswordHash))
            {
                if (requestedRole is not null && employeeUser.Role != requestedRole)
                    return Unauthorized(new { error = "invalid_credentials" });

                return Ok(new
                {
                    role = employeeUser.Role,
                    id = employeeUser.Id,
                    name = employeeUser.Name
                });
            }
        }

        return Unauthorized(new { error = "invalid_credentials" });
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Fname)
            || string.IsNullOrWhiteSpace(request.Lname)
            || string.IsNullOrWhiteSpace(request.Email)
            || string.IsNullOrWhiteSpace(request.Password)
            || string.IsNullOrWhiteSpace(request.Birthday))
        {
            return BadRequest(new { error = "missing_required_fields", message = "First name, last name, email, password, and date of birth are required." });
        }

        if (!DateOnly.TryParse(request.Birthday, CultureInfo.InvariantCulture, DateTimeStyles.None, out var birthDate))
            return BadRequest(new { error = "invalid_birthday", message = "Enter a valid date of birth." });

        var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
        if (birthDate > today)
            return BadRequest(new { error = "invalid_birthday", message = "Date of birth cannot be in the future." });

        await using var connection = _connectionFactory.CreateConnection();
        await connection.OpenAsync(cancellationToken);

        var requestedRole = string.IsNullOrWhiteSpace(request.Role)
            ? "hiker"
            : request.Role.Trim().ToLowerInvariant();

        var role = requestedRole is "hiker" or "employee" or "admin"
            ? requestedRole
            : "hiker";

        try
        {
            if (role == "hiker")
            {
                const string customerSql = """
                    INSERT INTO customer (fname, lname, email, password, birthday, registrationdate)
                    VALUES (@fname, @lname, @email, @password, @birthday, CURDATE());
                    """;
                await using var command = new MySqlCommand(customerSql, connection);
                command.Parameters.AddWithValue("@fname", request.Fname.Trim());
                command.Parameters.AddWithValue("@lname", request.Lname.Trim());
                command.Parameters.AddWithValue("@email", request.Email.Trim().ToLowerInvariant());
                command.Parameters.AddWithValue("@password", BCrypt.Net.BCrypt.HashPassword(request.Password));
                command.Parameters.AddWithValue("@birthday", birthDate.ToDateTime(TimeOnly.MinValue));

                await command.ExecuteNonQueryAsync(cancellationToken);
                var id = (int)command.LastInsertedId;
                return Ok(new { id, role = "hiker" });
            }
            else
            {
                const string employeeSql = """
                    INSERT INTO employee (fname, lname, role, email, password, birthday)
                    VALUES (@fname, @lname, @role, @email, @password, @birthday);
                    """;
                await using var command = new MySqlCommand(employeeSql, connection);
                command.Parameters.AddWithValue("@fname", request.Fname.Trim());
                command.Parameters.AddWithValue("@lname", request.Lname.Trim());
                command.Parameters.AddWithValue("@role", role);
                command.Parameters.AddWithValue("@email", request.Email.Trim().ToLowerInvariant());
                command.Parameters.AddWithValue("@password", BCrypt.Net.BCrypt.HashPassword(request.Password));
                command.Parameters.AddWithValue("@birthday", birthDate.ToDateTime(TimeOnly.MinValue));

                await command.ExecuteNonQueryAsync(cancellationToken);
                var id = (int)command.LastInsertedId;
                return Ok(new { id, role });
            }
        }
        catch (MySqlException ex) when (ex.Number == 1062)
        {
            return Conflict(new { error = "email_already_exists" });
        }
    }

    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile([FromQuery] string role, [FromQuery] int userId, CancellationToken cancellationToken)
    {
        var normalizedRole = string.IsNullOrWhiteSpace(role) ? "" : role.Trim().ToLowerInvariant();
        if (userId <= 0 || normalizedRole is not ("hiker" or "employee" or "admin"))
            return BadRequest(new { error = "invalid_request", message = "role and userId are required." });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            if (normalizedRole == "hiker")
            {
                const string sql = """
                    SELECT customerid, fname, lname, email, birthday, registrationdate
                    FROM customer
                    WHERE customerid = @id
                    LIMIT 1;
                    """;

                await using var command = new MySqlCommand(sql, connection);
                command.Parameters.AddWithValue("@id", userId);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (!await reader.ReadAsync(cancellationToken))
                    return NotFound(new { error = "not_found" });

                return Ok(new
                {
                    role = "hiker",
                    id = reader.GetInt32("customerid"),
                    fname = reader.IsDBNull(reader.GetOrdinal("fname")) ? "" : reader.GetString("fname"),
                    lname = reader.IsDBNull(reader.GetOrdinal("lname")) ? "" : reader.GetString("lname"),
                    email = reader.IsDBNull(reader.GetOrdinal("email")) ? "" : reader.GetString("email"),
                    birthday = FormatSqlDate(reader.GetValue(reader.GetOrdinal("birthday"))),
                    registrationDate = FormatSqlDate(reader.GetValue(reader.GetOrdinal("registrationdate")))
                });
            }

            const string empSql = """
                SELECT employeeid, fname, lname, role, email, birthday
                FROM employee
                WHERE employeeid = @id
                LIMIT 1;
                """;

            await using var empCmd = new MySqlCommand(empSql, connection);
            empCmd.Parameters.AddWithValue("@id", userId);
            await using var empReader = await empCmd.ExecuteReaderAsync(cancellationToken);
            if (!await empReader.ReadAsync(cancellationToken))
                return NotFound(new { error = "not_found" });

            var dbRole = empReader.IsDBNull(empReader.GetOrdinal("role"))
                ? "employee"
                : empReader.GetString(empReader.GetOrdinal("role")).Trim().ToLowerInvariant();
            if (dbRole is not ("employee" or "admin"))
                dbRole = "employee";

            if (normalizedRole != dbRole)
                return NotFound(new { error = "not_found" });

            return Ok(new
            {
                role = dbRole,
                id = empReader.GetInt32("employeeid"),
                fname = empReader.IsDBNull(empReader.GetOrdinal("fname")) ? "" : empReader.GetString(empReader.GetOrdinal("fname")),
                lname = empReader.IsDBNull(empReader.GetOrdinal("lname")) ? "" : empReader.GetString(empReader.GetOrdinal("lname")),
                email = empReader.IsDBNull(empReader.GetOrdinal("email")) ? "" : empReader.GetString("email"),
                birthday = FormatSqlDate(empReader.GetValue(empReader.GetOrdinal("birthday")))
            });
        }
        catch (MySqlException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "database_error", message = ex.Message });
        }
    }

    [HttpPatch("profile")]
    public async Task<IActionResult> PatchProfile([FromBody] ProfilePatchRequest body, CancellationToken cancellationToken)
    {
        var normalizedRole = string.IsNullOrWhiteSpace(body.Role) ? "" : body.Role.Trim().ToLowerInvariant();
        if (body.UserId <= 0 || normalizedRole is not ("hiker" or "employee" or "admin"))
            return BadRequest(new { error = "invalid_request", message = "role and userId are required." });

        if (string.IsNullOrWhiteSpace(body.Email) || string.IsNullOrWhiteSpace(body.Birthday))
            return BadRequest(new { error = "missing_fields", message = "Email and date of birth are required." });

        if (!DateOnly.TryParse(body.Birthday, CultureInfo.InvariantCulture, DateTimeStyles.None, out var birthDate))
            return BadRequest(new { error = "invalid_birthday", message = "Enter a valid date of birth." });

        var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
        if (birthDate > today)
            return BadRequest(new { error = "invalid_birthday", message = "Date of birth cannot be in the future." });

        try
        {
            await using var connection = _connectionFactory.CreateConnection();
            await connection.OpenAsync(cancellationToken);

            if (normalizedRole == "hiker")
            {
                if (string.IsNullOrWhiteSpace(body.Fname) || string.IsNullOrWhiteSpace(body.Lname))
                    return BadRequest(new { error = "missing_fields", message = "First and last name are required." });

                const string dupSql = """
                    SELECT COUNT(*) FROM customer
                    WHERE LOWER(email) = LOWER(@email) AND customerid <> @id;
                    """;
                await using (var dup = new MySqlCommand(dupSql, connection))
                {
                    dup.Parameters.AddWithValue("@email", body.Email.Trim());
                    dup.Parameters.AddWithValue("@id", body.UserId);
                    var count = Convert.ToInt32(await dup.ExecuteScalarAsync(cancellationToken));
                    if (count > 0)
                        return Conflict(new { error = "email_in_use", message = "That email is already in use." });
                }

                const string updateSql = """
                    UPDATE customer
                    SET fname = @fname, lname = @lname, email = @email, birthday = @birthday
                    WHERE customerid = @id;
                    """;
                await using var upd = new MySqlCommand(updateSql, connection);
                upd.Parameters.AddWithValue("@fname", body.Fname.Trim());
                upd.Parameters.AddWithValue("@lname", body.Lname.Trim());
                upd.Parameters.AddWithValue("@email", body.Email.Trim().ToLowerInvariant());
                upd.Parameters.AddWithValue("@birthday", birthDate.ToDateTime(TimeOnly.MinValue));
                upd.Parameters.AddWithValue("@id", body.UserId);
                var n = await upd.ExecuteNonQueryAsync(cancellationToken);
                if (n == 0)
                    return NotFound(new { error = "not_found" });

                return Ok(new
                {
                    role = "hiker",
                    id = body.UserId,
                    fname = body.Fname.Trim(),
                    lname = body.Lname.Trim(),
                    email = body.Email.Trim().ToLowerInvariant(),
                    birthday = birthDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                });
            }

            const string dupEmpSql = """
                SELECT COUNT(*) FROM employee
                WHERE LOWER(email) = LOWER(@email) AND employeeid <> @id;
                """;
            await using (var dupE = new MySqlCommand(dupEmpSql, connection))
            {
                dupE.Parameters.AddWithValue("@email", body.Email.Trim());
                dupE.Parameters.AddWithValue("@id", body.UserId);
                var count = Convert.ToInt32(await dupE.ExecuteScalarAsync(cancellationToken));
                if (count > 0)
                    return Conflict(new { error = "email_in_use", message = "That email is already in use." });
            }

            const string verifySql = """
                SELECT role FROM employee WHERE employeeid = @id LIMIT 1;
                """;
            string? dbRole = null;
            await using (var ver = new MySqlCommand(verifySql, connection))
            {
                ver.Parameters.AddWithValue("@id", body.UserId);
                var v = await ver.ExecuteScalarAsync(cancellationToken);
                if (v is null || v is DBNull)
                    return NotFound(new { error = "not_found" });
                dbRole = Convert.ToString(v)?.Trim().ToLowerInvariant();
            }

            if (dbRole is not ("employee" or "admin"))
                dbRole = "employee";
            if (normalizedRole != dbRole)
                return NotFound(new { error = "not_found" });

            if (string.IsNullOrWhiteSpace(body.Fname) || string.IsNullOrWhiteSpace(body.Lname))
                return BadRequest(new { error = "missing_fields", message = "First and last name are required." });

            const string updateEmpSql = """
                UPDATE employee
                SET fname = @fname, lname = @lname, email = @email, birthday = @birthday
                WHERE employeeid = @id;
                """;
            await using var updE = new MySqlCommand(updateEmpSql, connection);
            updE.Parameters.AddWithValue("@fname", (body.Fname ?? string.Empty).Trim());
            updE.Parameters.AddWithValue("@lname", (body.Lname ?? string.Empty).Trim());
            updE.Parameters.AddWithValue("@email", body.Email.Trim().ToLowerInvariant());
            updE.Parameters.AddWithValue("@birthday", birthDate.ToDateTime(TimeOnly.MinValue));
            updE.Parameters.AddWithValue("@id", body.UserId);
            var changed = await updE.ExecuteNonQueryAsync(cancellationToken);
            if (changed == 0)
                return NotFound(new { error = "not_found" });

            return Ok(new
            {
                role = dbRole,
                id = body.UserId,
                fname = (body.Fname ?? string.Empty).Trim(),
                lname = (body.Lname ?? string.Empty).Trim(),
                email = body.Email.Trim().ToLowerInvariant(),
                birthday = birthDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            });
        }
        catch (MySqlException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = "database_error", message = ex.Message });
        }
    }

    private static string? FormatSqlDate(object? value)
    {
        if (value is null or DBNull)
            return null;
        if (value is MySqlDateTime mdt)
        {
            if (!mdt.IsValidDateTime)
                return null;
            return DateOnly.FromDateTime(mdt.GetDateTime()).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
        if (value is DateTime dt)
            return DateOnly.FromDateTime(dt).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (value is DateOnly d)
            return d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        if (value is string s)
        {
            s = s.Trim();
            if (s.Length == 0) return null;
            if (DateOnly.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
                return parsed.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDt))
                return DateOnly.FromDateTime(parsedDt).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            return s;
        }
        return value.ToString();
    }

    private static bool VerifyPassword(string candidatePassword, string storedHashOrPassword)
    {
        if (string.IsNullOrWhiteSpace(storedHashOrPassword))
            return false;

        return BCrypt.Net.BCrypt.Verify(candidatePassword, storedHashOrPassword);
    }

    private static async Task<CustomerUser?> FindCustomerAsync(
        MySqlConnection connection,
        string email,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT customerid, fname, lname, password
            FROM customer
            WHERE LOWER(email) = LOWER(@email)
            LIMIT 1;
            """;

        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@email", email.Trim());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        var id = reader.GetInt32("customerid");
        var fnameOrdinal = reader.GetOrdinal("fname");
        var lnameOrdinal = reader.GetOrdinal("lname");
        var passwordOrdinal = reader.GetOrdinal("password");
        var fname = reader.IsDBNull(fnameOrdinal) ? string.Empty : reader.GetString(fnameOrdinal);
        var lname = reader.IsDBNull(lnameOrdinal) ? string.Empty : reader.GetString(lnameOrdinal);
        var passwordHash = reader.IsDBNull(passwordOrdinal) ? string.Empty : reader.GetString(passwordOrdinal);
        var name = string.Join(' ', new[] { fname, lname }.Where(x => !string.IsNullOrWhiteSpace(x))).Trim();
        if (string.IsNullOrWhiteSpace(name))
            name = $"Customer #{id}";

        return new CustomerUser(id, name, passwordHash);
    }

    private static async Task<EmployeeUser?> FindEmployeeAsync(
        MySqlConnection connection,
        string email,
        CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT employeeid, fname, lname, role, email, password
            FROM employee
            WHERE LOWER(email) = LOWER(@email)
            LIMIT 1;
            """;

        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@email", email.Trim());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return null;

        var id = reader.GetInt32("employeeid");
        var fnameOrdinal = reader.GetOrdinal("fname");
        var lnameOrdinal = reader.GetOrdinal("lname");
        var roleOrdinal = reader.GetOrdinal("role");
        var emailOrdinal = reader.GetOrdinal("email");
        var passwordOrdinal = reader.GetOrdinal("password");
        var fname = reader.IsDBNull(fnameOrdinal) ? string.Empty : reader.GetString(fnameOrdinal);
        var lname = reader.IsDBNull(lnameOrdinal) ? string.Empty : reader.GetString(lnameOrdinal);
        var role = reader.IsDBNull(roleOrdinal) ? "employee" : reader.GetString(roleOrdinal).Trim().ToLowerInvariant();
        if (role is not ("employee" or "admin"))
            role = "employee";

        var emailValue = reader.IsDBNull(emailOrdinal) ? string.Empty : reader.GetString(emailOrdinal);
        var passwordHash = reader.IsDBNull(passwordOrdinal) ? string.Empty : reader.GetString(passwordOrdinal);
        var name = string.Join(' ', new[] { fname, lname }.Where(x => !string.IsNullOrWhiteSpace(x))).Trim();
        if (string.IsNullOrWhiteSpace(name))
            name = $"Employee #{id}";

        return new EmployeeUser(id, name, role, passwordHash);
    }

    public sealed record LoginRequest(string Email, string Password, string? Role);
    public sealed record RegisterRequest(string Fname, string Lname, string Email, string Password, string Birthday, string? Role);
    public sealed record ProfilePatchRequest(string Role, int UserId, string? Fname, string? Lname, string Email, string Birthday);

    private sealed record CustomerUser(int Id, string Name, string PasswordHash);
    private sealed record EmployeeUser(int Id, string Name, string Role, string PasswordHash);
}

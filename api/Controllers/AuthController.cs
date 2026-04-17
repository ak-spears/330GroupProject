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

        var employeeUser = await FindEmployeeAsync(connection, request.Email, cancellationToken);
        if (employeeUser is not null && VerifyPassword(request.Password, employeeUser.PasswordHash))
        {
            return Ok(new
            {
                role = employeeUser.Role,
                id = employeeUser.Id,
                name = employeeUser.Name
            });
        }

        return Unauthorized(new { error = "invalid_credentials" });
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Fname)
            || string.IsNullOrWhiteSpace(request.Lname)
            || string.IsNullOrWhiteSpace(request.Email)
            || string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new { error = "missing_required_fields" });
        }

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
                    INSERT INTO customer (fname, lname, email, password, registrationdate)
                    VALUES (@fname, @lname, @email, @password, CURDATE());
                    """;
                await using var command = new MySqlCommand(customerSql, connection);
                command.Parameters.AddWithValue("@fname", request.Fname.Trim());
                command.Parameters.AddWithValue("@lname", request.Lname.Trim());
                command.Parameters.AddWithValue("@email", request.Email.Trim().ToLowerInvariant());
                command.Parameters.AddWithValue("@password", BCrypt.Net.BCrypt.HashPassword(request.Password));

                await command.ExecuteNonQueryAsync(cancellationToken);
                var id = (int)command.LastInsertedId;
                return Ok(new { id, role = "hiker" });
            }
            else
            {
                const string employeeSql = """
                    INSERT INTO employee (role, email, password)
                    VALUES (@role, @email, @password);
                    """;
                await using var command = new MySqlCommand(employeeSql, connection);
                command.Parameters.AddWithValue("@role", role);
                command.Parameters.AddWithValue("@email", request.Email.Trim().ToLowerInvariant());
                command.Parameters.AddWithValue("@password", BCrypt.Net.BCrypt.HashPassword(request.Password));

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
            SELECT employeeid, role, email, password
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
        var roleOrdinal = reader.GetOrdinal("role");
        var emailOrdinal = reader.GetOrdinal("email");
        var passwordOrdinal = reader.GetOrdinal("password");
        var role = reader.IsDBNull(roleOrdinal) ? "employee" : reader.GetString(roleOrdinal).Trim().ToLowerInvariant();
        if (role is not ("employee" or "admin"))
            role = "employee";

        var emailValue = reader.IsDBNull(emailOrdinal) ? string.Empty : reader.GetString(emailOrdinal);
        var passwordHash = reader.IsDBNull(passwordOrdinal) ? string.Empty : reader.GetString(passwordOrdinal);
        var name = string.IsNullOrWhiteSpace(emailValue) ? $"Employee #{id}" : emailValue;

        return new EmployeeUser(id, name, role, passwordHash);
    }

    public sealed record LoginRequest(string Email, string Password);
    public sealed record RegisterRequest(string Fname, string Lname, string Email, string Password, string? Role);

    private sealed record CustomerUser(int Id, string Name, string PasswordHash);
    private sealed record EmployeeUser(int Id, string Name, string Role, string PasswordHash);
}

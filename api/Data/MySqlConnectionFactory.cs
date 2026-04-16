using MySqlConnector;

namespace TrailBuddy.Api.Data;

/// <summary>
/// Opens <see cref="MySqlConnection"/> instances using the configured connection string
/// (<c>ConnectionStrings:Default</c>, populated from repo <c>.env</c> <c>Connection_String</c> if present).
/// </summary>
public sealed class MySqlConnectionFactory
{
    private readonly string _connectionString;

    public MySqlConnectionFactory(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:Default is not configured. Set Connection_String in the repo root .env file or ConnectionStrings:Default in appsettings / user secrets.");
    }

    public MySqlConnection CreateConnection() => new(_connectionString);
}

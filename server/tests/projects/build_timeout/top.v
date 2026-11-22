// Проект для теста BUILD_TIMEOUT: сборка заведомо дольше предела, заданного тестом.
module top (
    input  wire        clk,
    output wire [63:0] out
);
    genvar i;
    wire [63:0] stage [0:400];
    assign stage[0] = 64'h9E3779B97F4A7C15;
    generate
        for (i = 0; i < 400; i = i + 1) begin : g
            reg [63:0] r = 0;
            always @(posedge clk) r <= (stage[i] * 64'd6364136223846793005 + i) ^ (stage[i] >> 7);
            assign stage[i + 1] = r;
        end
    endgenerate
    assign out = stage[400];
endmodule

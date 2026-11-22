// Урок 4: три светодиода мигают с разной частотой: 1, 2 и 5 раз в секунду.
// Три независимых счётчика работают одновременно: это три отдельные схемы.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,   // 27 МГц, вывод 4
    output wire [2:0] led    // LED0..LED2, выводы 15..17, горят при 0
);
    // Полпериода мигания с частотой F Гц: CLK_HZ / (2 * F) тактов.
    localparam integer HALF0 = CLK_HZ / 2  - 1;   // 1 Гц: 13 499 999 → 24 бита
    localparam integer HALF1 = CLK_HZ / 4  - 1;   // 2 Гц:  6 749 999 → 23 бита
    localparam integer HALF2 = CLK_HZ / 10 - 1;   // 5 Гц:  2 699 999 → 22 бита

    reg [23:0] cnt0 = 24'd0;
    reg [22:0] cnt1 = 23'd0;
    reg [21:0] cnt2 = 22'd0;
    reg [2:0]  state = 3'b000;   // 1 = светодиод должен гореть

    // Счётчик для LED0
    always @(posedge clk) begin
        if (cnt0 == HALF0) begin
            cnt0     <= 24'd0;
            state[0] <= ~state[0];
        end else begin
            cnt0 <= cnt0 + 1'b1;
        end
    end

    // Счётчик для LED1
    always @(posedge clk) begin
        if (cnt1 == HALF1) begin
            cnt1     <= 23'd0;
            state[1] <= ~state[1];
        end else begin
            cnt1 <= cnt1 + 1'b1;
        end
    end

    // Счётчик для LED2
    always @(posedge clk) begin
        if (cnt2 == HALF2) begin
            cnt2     <= 22'd0;
            state[2] <= ~state[2];
        end else begin
            cnt2 <= cnt2 + 1'b1;
        end
    end

    assign led = ~state;   // светодиоды горят по нулю
endmodule
